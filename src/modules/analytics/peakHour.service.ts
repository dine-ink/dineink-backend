// Peak Hour Depletion — staff/equipment requirement analysis, kitchen
// bottleneck detection, and order-completion ETA prediction. Extends the
// existing analytics module rather than duplicating it: the hourly
// bucketing here is REUSED from getKitchenAnalyticsService (same
// hour-of-day, all-days-in-range bucketing it already does for order
// volume/avg completion time), not re-queried from scratch — see the
// comment above getPeakHourAnalysisService for why reuse was possible here.
import prisma from "../../config/prisma";
import { getKitchenAnalyticsService } from "./analyticsAdvanced.service";
import {
  computeBottleneckStatus,
  computeEtaPrediction,
  computeStaffRequirement,
} from "./peakHour.formulas";

// Kitchen-active (not-yet-terminal) statuses. "READY" is the terminal
// kitchen state (see runningOrder.service.ts's updateRunningOrderStatusService,
// which stamps completedAt when kitchenStatus flips to "READY") — anything
// still PENDING/PREPARING is genuinely sitting in the kitchen queue.
const ACTIVE_KITCHEN_STATUSES = ["PENDING", "PREPARING"];

const getCurrentQueueDepth = (restaurantId: number, branchId: number) =>
  prisma.runningOrder.count({
    where: {
      restaurantId,
      branchId,
      status: "ACTIVE",
      kitchenStatus: { in: ACTIVE_KITCHEN_STATUSES },
    },
  });

const getBranchCapacityPolicy = (branchId: number) =>
  prisma.branch.findUnique({
    where: { id: branchId },
    select: { kitchenCapacityPerHour: true, autoThrottleEnabled: true },
  });

// ─── 1. Peak Hour Analysis ────────────────────────────────────────────────────

export const getPeakHourAnalysisService = async (
  restaurantId: number,
  branchId: number,
  from?: string,
  to?: string,
) => {
  // getKitchenAnalyticsService already buckets every completed order by
  // hour-of-day (0-23, across all days in [from,to]) and returns
  // {hour, label, orders, avgTime} per bucket — avgTime there IS the average
  // (completedAt - startedAt) in minutes for that bucket, i.e. exactly the
  // "avg wait time" metric this feature needs. Rather than re-querying
  // RunningOrder and re-deriving that duration math a second time, we call
  // the existing service and relabel/extend its hourlyData — one source of
  // truth for "how long did orders take in hour H".
  const [kitchen, branch, currentQueueDepth] = await Promise.all([
    getKitchenAnalyticsService(restaurantId, branchId, from, to),
    getBranchCapacityPolicy(branchId),
    getCurrentQueueDepth(restaurantId, branchId),
  ]);

  const kitchenCapacityPerHour = branch?.kitchenCapacityPerHour ?? null;
  const autoThrottleEnabled = branch?.autoThrottleEnabled ?? false;

  const hourly = kitchen.hourlyData.map((h) => {
    const { isBottleneck, utilizationPercent } = computeBottleneckStatus(
      h.orders,
      kitchenCapacityPerHour,
    );
    return {
      hour: h.hour,
      label: h.label,
      orders: h.orders,
      staffRequirement: computeStaffRequirement(h.orders),
      isBottleneck,
      utilizationPercent,
      avgWaitMinutes: h.avgTime,
    };
  });

  // Live bottleneck status uses the CURRENT active queue depth as the
  // "orders in this hour" proxy — not the historical hour-of-day bucket —
  // since what matters right now is how many orders are actually sitting in
  // the kitchen this instant, not how busy this hour-of-day usually is.
  const { isBottleneck: isBottleneckNow, utilizationPercent: utilizationPercentNow } =
    computeBottleneckStatus(currentQueueDepth, kitchenCapacityPerHour);

  return {
    hourly,
    current: {
      queueDepth: currentQueueDepth,
      isBottleneckNow,
      utilizationPercentNow,
      // Exceeding capacity only ever produces a hold *suggestion* here, never
      // an auto-reject — the branch's autoThrottleEnabled flag is purely
      // advisory data for the caller (e.g. the KDS UI) to act on.
      throttleSuggested: isBottleneckNow && autoThrottleEnabled,
    },
  };
};

// ─── 2. ETA Prediction ────────────────────────────────────────────────────────

const ETA_TRAILING_DAYS = 14;
const MIN_SAMPLE_SIZE = 5;

type OrderTypeKey = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
const ORDER_TYPES: OrderTypeKey[] = ["DINE_IN", "TAKEAWAY", "DELIVERY"];
const RESPONSE_KEY: Record<OrderTypeKey, string> = {
  DINE_IN: "dineIn",
  TAKEAWAY: "takeaway",
  DELIVERY: "delivery",
};

export const getEtaPredictionService = async (
  restaurantId: number,
  branchId: number,
  orderType?: OrderTypeKey,
) => {
  const since = new Date();
  since.setDate(since.getDate() - ETA_TRAILING_DAYS);

  // Historical completion time, computed the same way
  // getKitchenAnalyticsService does (mins = completedAt - startedAt, in JS —
  // Prisma can't diff two DateTime columns in a groupBy), over a trailing
  // 14-day window. 14 days is enough sample volume to smooth out a single
  // slow/quiet day while still reflecting recent kitchen performance rather
  // than a whole quarter's worth of drift.
  const completed = await prisma.runningOrder.findMany({
    where: {
      restaurantId,
      branchId,
      completedAt: { not: null },
      startedAt: { gte: since },
    },
    select: { orderType: true, startedAt: true, completedAt: true },
  });

  const timed = completed
    .map((o) => ({
      orderType: (o.orderType || "DINE_IN") as string,
      mins: Math.round(
        (new Date(o.completedAt!).getTime() - new Date(o.startedAt).getTime()) / 60000,
      ),
    }))
    .filter((o) => o.mins > 0 && o.mins < 300); // same anomaly filter as getKitchenAnalyticsService

  const overallAvg = timed.length
    ? Math.round(timed.reduce((s, o) => s + o.mins, 0) / timed.length)
    : 0;

  const byType = new Map<string, { count: number; totalMins: number }>();
  timed.forEach((o) => {
    const entry = byType.get(o.orderType) ?? { count: 0, totalMins: 0 };
    entry.count++;
    entry.totalMins += o.mins;
    byType.set(o.orderType, entry);
  });

  const currentQueueDepth = await getCurrentQueueDepth(restaurantId, branchId);

  const buildForType = (type: OrderTypeKey) => {
    const stats = byType.get(type);
    const sampleSize = stats?.count ?? 0;

    // Fall back to the overall (all-order-types) average when a specific
    // type has too little data to trust on its own.
    const hasEnoughData = sampleSize >= MIN_SAMPLE_SIZE;
    const historicalAvgMinutes = hasEnoughData
      ? Math.round(stats!.totalMins / stats!.count)
      : overallAvg;

    // No online-delivery order flow exists in this backend yet (no
    // delivery/online-order module) — DELIVERY is a valid orderType value
    // in principle, but in practice this branch will almost always have
    // zero or near-zero completed DELIVERY orders. Don't fabricate a
    // predicted number off a near-empty (or the unrelated overall-average)
    // sample; surface that explicitly instead.
    if (type === "DELIVERY" && sampleSize === 0) {
      return {
        predictedMinutes: 0,
        historicalAvgMinutes: 0,
        sampleSize: 0,
        note: "Insufficient delivery order data — no online-delivery module exists yet",
      };
    }

    return {
      predictedMinutes: computeEtaPrediction(historicalAvgMinutes, currentQueueDepth),
      historicalAvgMinutes,
      sampleSize,
    };
  };

  if (orderType) {
    return buildForType(orderType);
  }

  return ORDER_TYPES.reduce((acc, type) => {
    acc[RESPONSE_KEY[type]] = buildForType(type);
    return acc;
  }, {} as Record<string, ReturnType<typeof buildForType>>);
};
