// The Forecast Engine's pure time-series math — no DB access, fully
// unit-testable. Every derived financial metric (percentages, EBITDA, prime
// cost, break-even, etc.) is deliberately NOT computed here: forecast.service.ts
// forecasts each raw ₹/count series independently with these functions, sums
// the predicted totals across the horizon, and hands the aggregated raw
// figures to computeFinancialMetrics (finance.formulas.ts, unmodified) — the
// same "reuse, don't duplicate" pattern already established for Budget and
// Scenario. Only the genuinely new part — predicting a raw figure's future
// value from its own history — lives in this file.
//
// Extensibility: each model is a plain (values, horizon) => number[]
// function. A future ML-based model just needs to fit this same shape and
// be added to runForecastModel/resolveEffectiveModel below — nothing else
// in the module needs to change.
import { ConfidenceLevel, ConfidenceResult, ForecastGranularity, ForecastModelValue, HistoricalPoint, SeriesForecastResult } from "./forecast.types";

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const stdDev = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** Ordinary least squares over the series' own index (0..n-1) as x. */
export const linearRegression = (values: number[]): { slope: number; intercept: number } => {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = values.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * values[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
};

/** Historical Trend — fits a straight line through the whole series and extrapolates it forward. Never predicts below 0 (revenue/orders/cost figures are never negative). */
export const forecastTrend = (values: number[], horizon: number): number[] => {
  if (values.length === 0) return Array(horizon).fill(0);
  if (values.length === 1) return Array(horizon).fill(Math.max(0, values[0]));
  const { slope, intercept } = linearRegression(values);
  const n = values.length;
  return Array.from({ length: horizon }, (_, k) => Math.max(0, intercept + slope * (n + k)));
};

/** Moving Average — a flat continuation of the average of the last `window` periods (default 3, or the whole series if shorter). */
export const forecastMovingAverage = (values: number[], horizon: number, window = 3): number[] => {
  if (values.length === 0) return Array(horizon).fill(0);
  const w = Math.min(window, values.length);
  const avg = mean(values.slice(-w));
  return Array(horizon).fill(Math.max(0, avg));
};

/**
 * Seasonal — naive "same calendar period last year, adjusted for the
 * average year-over-year growth rate observed across the series." Monthly
 * granularity only; needs at least 13 points (one full year plus one) to
 * derive a single YoY ratio, returns null otherwise so the caller can fall
 * back to a simpler model. A documented v1 method — the extensible seam for
 * a future STL/Holt-Winters/ML model without changing anything else here.
 */
export const forecastSeasonal = (values: number[], horizon: number): number[] | null => {
  const n = values.length;
  if (n < 13) return null;

  const yoyRatios: number[] = [];
  for (let i = 12; i < n; i++) {
    if (values[i - 12] > 0) yoyRatios.push(values[i] / values[i - 12]);
  }
  const yoyGrowth = yoyRatios.length > 0 ? mean(yoyRatios) : 1;

  return Array.from({ length: horizon }, (_, k) => {
    const anchorIndex = n + k - 12; // the same calendar month one year before this future period
    const anchorValue = anchorIndex >= 0 && anchorIndex < n ? values[anchorIndex] : values[n - 1];
    return Math.max(0, anchorValue * yoyGrowth);
  });
};

/**
 * Confidence — a simple, documented heuristic (not a statistical p-value):
 * High needs >= 6 historical periods, low volatility (CV <= 30%), and no
 * activity gaps; Medium needs >= 3 periods and CV <= 60%; everything else is
 * Low. Every disqualifying factor is surfaced as a human-readable reason so
 * the dashboard can explain *why*, not just show a badge.
 */
export const computeConfidence = (points: HistoricalPoint[]): ConfidenceResult => {
  const dataPoints = points.length;
  const reasons: string[] = [];

  if (dataPoints < 3) {
    reasons.push(`Insufficient history — only ${dataPoints} period(s) of data available (need at least 3)`);
    return { level: "low", reasons, dataPoints };
  }

  const values = points.map((p) => p.value);
  const m = mean(values);
  const cv = m !== 0 ? stdDev(values) / Math.abs(m) : 0;
  const missing = points.filter((p) => !p.hasActivity).length;

  if (cv > 0.6) reasons.push(`Highly volatile sales — values vary by ${Math.round(cv * 100)}% relative to their average`);
  if (missing > 0) reasons.push(`${missing} historical period(s) had no recorded activity (missing data)`);
  if (dataPoints < 6) reasons.push(`Limited history — only ${dataPoints} period(s) available`);

  let level: ConfidenceLevel;
  if (dataPoints >= 6 && cv <= 0.3 && missing === 0) level = "high";
  else if (dataPoints >= 3 && cv <= 0.6) level = "medium";
  else level = "low";

  if (reasons.length === 0) reasons.push("Sufficient, stable historical data");
  return { level, reasons, dataPoints };
};

/** Downgrades a requested model to whatever the available history can actually support, with a human-readable reason attached when it does. */
export const resolveEffectiveModel = (
  requested: ForecastModelValue,
  granularity: ForecastGranularity,
  dataPoints: number,
): { model: ForecastModelValue; downgradeReason: string | null } => {
  if (requested === "SEASONAL") {
    if (granularity !== "month") {
      return { model: "HISTORICAL_TREND", downgradeReason: "Seasonal forecasting needs monthly history — not available for a weekly forecast, falling back to Historical Trend" };
    }
    if (dataPoints < 13) {
      const fallback = dataPoints >= 2 ? "HISTORICAL_TREND" : "MOVING_AVERAGE";
      return { model: fallback, downgradeReason: `Seasonal forecasting needs at least 13 months of history (have ${dataPoints}) — falling back to ${fallback === "HISTORICAL_TREND" ? "Historical Trend" : "Moving Average"}` };
    }
    return { model: "SEASONAL", downgradeReason: null };
  }
  if (requested === "HISTORICAL_TREND" && dataPoints < 2) {
    return { model: "MOVING_AVERAGE", downgradeReason: `Trend forecasting needs at least 2 periods of history (have ${dataPoints}) — falling back to Moving Average` };
  }
  return { model: requested, downgradeReason: null };
};

const runForecastModel = (model: ForecastModelValue, values: number[], horizon: number): number[] => {
  if (model === "SEASONAL") return forecastSeasonal(values, horizon) ?? forecastTrend(values, horizon);
  if (model === "MOVING_AVERAGE") return forecastMovingAverage(values, horizon);
  return forecastTrend(values, horizon);
};

/** The one function forecast.service.ts calls per raw KPI series — resolves the effective model, runs it, and scores confidence, all in one place. */
export const forecastSeries = (
  points: HistoricalPoint[],
  requestedModel: ForecastModelValue,
  granularity: ForecastGranularity,
  horizon: number,
): SeriesForecastResult => {
  const { model, downgradeReason } = resolveEffectiveModel(requestedModel, granularity, points.length);
  const perPeriod = runForecastModel(model, points.map((p) => p.value), horizon);
  const confidence = computeConfidence(points);
  if (downgradeReason) {
    confidence.reasons = [downgradeReason, ...confidence.reasons];
    if (confidence.level === "high") confidence.level = "medium"; // a forced model downgrade is itself a reason to not call this "high confidence"
  }
  const predictedTotal = perPeriod.reduce((s, v) => s + v, 0);
  return { predictedTotal, perPeriod, modelUsed: model, confidence };
};

/** Weakest-link confidence across every raw series feeding one forecast run — a derived KPI (e.g. EBITDA) is only as reliable as its least-reliable input. */
export const combineConfidence = (results: ConfidenceResult[]): { level: ConfidenceLevel; reasons: string[] } => {
  const order: ConfidenceLevel[] = ["low", "medium", "high"];
  const level = results.reduce<ConfidenceLevel>((worst, r) => (order.indexOf(r.level) < order.indexOf(worst) ? r.level : worst), "high");
  const reasons = [...new Set(results.flatMap((r) => r.reasons))];
  return { level, reasons };
};
