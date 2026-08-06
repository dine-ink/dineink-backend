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

/**
 * Peak Hour Forecast — projects the branch's busiest-hour ORDER VOLUME
 * (not the full 24-hour breakdown) forward through the same 3-model
 * machinery (forecastSeries) every other raw series in this module already
 * goes through, then derives the staff headcount that volume would need via
 * computeStaffRequirement (analytics/peakHour.formulas.ts) — reused, not
 * reimplemented. `perPeriod` holds one projected value per future
 * sub-period of the horizon (e.g. 3 monthly values for NEXT_QUARTER);
 * `predictedPeakHourOrders` is the LAST of those (the target period itself).
 */
export interface PeakHourForecastResult {
  restaurantId: number;
  branchId: number;
  periodType: ForecastPeriodTypeValue;
  requestedModel: ForecastModelValue;
  modelUsed: ForecastModelValue;
  granularity: ForecastGranularity;
  targetStartDate: string;
  targetEndDate: string;
  historicalPeriodsUsed: number;
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
  perPeriod: number[];
  predictedPeakHourOrders: number;
  /** Most recent COMPLETE historical period's actual busiest-hour order count — the same "vs last period" reference ForecastKpiRow.baseline gives every financial KPI. */
  baselinePeakHourOrders: number | null;
  variancePercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
  projectedStaffRequirement: number;
}

/** One ingredient's projected demand — see getDemandForecastService. */
export interface DemandForecastItem {
  ingredientId: number;
  name: string;
  unit: string | null;
  historicalDailyAverage: number;
  projectedDailyConsumption: number;
  modelUsed: ForecastModelValue;
  confidence: ConfidenceLevel;
}

export interface DemandForecastResult {
  restaurantId: number;
  branchId: number;
  periodType: ForecastPeriodTypeValue;
  requestedModel: ForecastModelValue;
  trailingDaysAnalyzed: number;
  items: DemandForecastItem[];
}

/**
 * One ingredient's stock-out projection — deliberately NOT shaped as a
 * ForecastKpiRow. The KPI shape is one scalar per period (baseline/predicted/
 * variance); this is a per-ingredient LIST with its own currentQuantity/
 * reorderLevel/flag, which doesn't reduce to a single number per period. A
 * dedicated getInventoryForecastService returning this list is a better fit
 * than forcing it into KPI_DEFINITIONS.
 */
export interface InventoryForecastItem {
  ingredientId: number;
  ingredientName: string;
  unit: string | null;
  currentQuantity: number;
  reorderLevel: number | null;
  projectedDailyConsumption: number;
  daysUntilStockout: number | null;
  reorderRecommended: boolean;
}
