// Peak Hour Depletion — pure, DB-free calculation functions. Same convention
// as finance.formulas.ts: every number quoted by the peak-hour service must
// come from calling one of these, never re-derived inline, so staffing/
// bottleneck/ETA math stays defined in exactly one place.
//
// The ETA model here (computeEtaPrediction) is a deliberately simple,
// defensible queue-depth-weighted heuristic — historical average completion
// time scaled up when the current active-order queue is deeper than a
// baseline. It is NOT a machine-learned model. This matches the rest of the
// codebase's rules-based (not ML) approach to prediction — see
// ai.rules.ts's header ("deterministic, no LLM") and ai.service.ts's header
// ("pure composition + rules layer... No LLM is called anywhere here") for
// the precedent this follows.

// Default staffing throughput assumption: how many orders one kitchen staff
// member can comfortably handle in an hour. Tunable — callers can override
// per-branch once that becomes configurable; kept as a named export so it's
// a single source of truth rather than a magic number scattered around.
export const DEFAULT_ORDERS_PER_STAFF_HOUR = 8;

/**
 * Minimum kitchen staff needed to handle a given number of orders in an
 * hour, at `ordersPerStaffHour` throughput per staff member. Always at
 * least 1 if there are any orders at all, 0 if there are none (no orders,
 * no staffing need to flag).
 */
export const computeStaffRequirement = (
  ordersInHour: number,
  ordersPerStaffHour: number = DEFAULT_ORDERS_PER_STAFF_HOUR,
): number => {
  if (!ordersInHour || ordersInHour <= 0) return 0;
  if (!ordersPerStaffHour || ordersPerStaffHour <= 0) return 1;
  return Math.max(1, Math.ceil(ordersInHour / ordersPerStaffHour));
};

export interface BottleneckStatus {
  isBottleneck: boolean;
  utilizationPercent: number | null;
}

/**
 * Whether a given order volume is at/over kitchen capacity for the hour.
 * If the branch hasn't configured a kitchenCapacityPerHour (null/0), there
 * is nothing to compare against — returns "no assessment possible" rather
 * than guessing a threshold.
 */
export const computeBottleneckStatus = (
  ordersInHour: number,
  kitchenCapacityPerHour: number | null | undefined,
): BottleneckStatus => {
  if (!kitchenCapacityPerHour) {
    return { isBottleneck: false, utilizationPercent: null };
  }
  const utilizationPercent = Math.round((ordersInHour / kitchenCapacityPerHour) * 100);
  return { isBottleneck: utilizationPercent >= 90, utilizationPercent };
};

/**
 * Predicted order-completion time (minutes) for an order type, given its
 * historical average completion time and how deep the current active-order
 * queue is relative to a baseline "normal" queue depth.
 *
 * Model: predictedMinutes = historicalAvg * (1 + max(0, (queueDepth -
 * baseline) / baseline) * 0.5)
 *
 * i.e. once the live queue is deeper than baseline, scale the historical
 * average up by half the proportional overshoot; a queue at or below
 * baseline predicts exactly the historical average (no penalty, no
 * discount below it — a shallow queue doesn't make food come out faster
 * than its own prep time). This is a straightforward queue-depth-weighted
 * heuristic, not a machine-learned model — see the file header.
 */
export const computeEtaPrediction = (
  historicalAvgMinutesForType: number,
  currentActiveQueueDepth: number,
  baselineQueueDepth: number = 5,
): number => {
  if (!historicalAvgMinutesForType || historicalAvgMinutesForType <= 0) return 0;
  const safeBaseline = baselineQueueDepth > 0 ? baselineQueueDepth : 5;
  const overshoot = Math.max(0, (currentActiveQueueDepth - safeBaseline) / safeBaseline);
  return Math.round(historicalAvgMinutesForType * (1 + overshoot * 0.5));
};
