export type ForecastPeriodTypeValue = "NEXT_WEEK" | "NEXT_MONTH" | "NEXT_QUARTER" | "NEXT_6_MONTHS" | "NEXT_YEAR";
export type ForecastModelValue = "HISTORICAL_TREND" | "MOVING_AVERAGE" | "SEASONAL";
export type ConfidenceLevel = "high" | "medium" | "low";
export type ForecastGranularity = "week" | "month";

/** One historical period's value for a single raw KPI series, plus whether that period had any real activity (orders > 0) — a zero from a genuinely slow-but-real period is not the same as a gap in the data. */
export interface HistoricalPoint {
  value: number;
  hasActivity: boolean;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  reasons: string[];
  dataPoints: number;
}

/** The result of forecasting ONE raw time series (e.g. just Revenue) across the requested horizon. */
export interface SeriesForecastResult {
  /** Sum of every future period's predicted value — e.g. "next quarter's total revenue" = 3 predicted months summed. */
  predictedTotal: number;
  perPeriod: number[];
  modelUsed: ForecastModelValue;
  confidence: ConfidenceResult;
}

/** One row of the Forecast dashboard/report — mirrors ProjectedKpiRow from the Scenario module's shape for UI consistency. */
export interface ForecastKpiRow {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  /** Most recent complete historical period's actual — a quick "vs last period" reference, not the forecast basis itself (the model may look back further). */
  baseline: number | null;
  predicted: number | null;
  variance: number | null;
  variancePercentage: number | null;
  achievementPercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
}

export interface ForecastAlert {
  severity: "critical" | "warning" | "info";
  key: string;
  message: string;
}

export interface ForecastResult {
  restaurantId: number;
  branchId: number | null;
  periodType: ForecastPeriodTypeValue;
  requestedModel: ForecastModelValue;
  modelUsed: ForecastModelValue;
  granularity: ForecastGranularity;
  targetStartDate: string;
  targetEndDate: string;
  historicalPeriodsUsed: number;
  overallConfidence: ConfidenceLevel;
  confidenceReasons: string[];
  kpis: ForecastKpiRow[];
  alerts: ForecastAlert[];
}

/** The frozen shape written into FinancialForecast.predictions (JSON) at snapshot time. */
export interface ForecastSnapshotPayload {
  modelUsed: ForecastModelValue;
  granularity: ForecastGranularity;
  historicalPeriodsUsed: number;
  overallConfidence: ConfidenceLevel;
  confidenceReasons: string[];
  kpis: { key: string; label: string; unit: "currency" | "percentage" | "count"; higherIsBetter: boolean; predicted: number | null }[];
}

export interface ForecastVsActualRow {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  forecast: number | null;
  actual: number | null;
  variance: number | null;
  variancePercentage: number | null;
  accuracyPercentage: number | null;
}
