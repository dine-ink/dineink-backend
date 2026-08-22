// Labor & Kitchen Capacity Engine — calibrating the owner's entered labor
// standards against what the kitchen actually did.
//
// WHAT THIS CAN AND CANNOT LEARN, stated up front, because the difference
// decides what the numbers below are allowed to claim:
//
//   CAN: relative per-ITEM corrections. RunningOrder records startedAt and
//   completedAt, so every completed order is one observed duration covering a
//   known item mix. Across many orders, items that consistently appear in
//   longer-than-predicted tickets can be separated from items that don't.
//
//   CANNOT: the absolute level of hands-on minutes. An order's wall-clock
//   duration is hands-on time PLUS queue wait, and several cooks work items in
//   parallel — so wall clock is neither the sum of labor minutes nor any fixed
//   multiple of it. Factors are therefore MEDIAN-NORMALISED (see
//   normaliseFactors): only the relative differences between items survive,
//   and the overall level stays the owner's.
//
//   CANNOT: per-EMPLOYEE speed. Nothing in the schema records which cook
//   prepared which item — RunningOrderBatchItem has no userId, and Attendance
//   only says who was in the building. So StaffStationSkill.speedFactor stays
//   owner-entered, and the per-staff figures reported here are labelled
//   correlational throughput context, NOT an attributed speed. Two people on
//   the same shift get the same order count credited to both.
//
// Deterministic arithmetic, not a fitted model — same stance as the rest of the
// module.

import prisma from "../../config/prisma";
import { runChunkedWrites } from "./labor.batch";
import {
  MAX_CONCURRENCY_FOR_CALIBRATION,
  computeItemCalibrationFactors,
  computeOrderConcurrency,
  resolveEffectiveMinutes,
  type CalibrationObservation,
  type StationTimeStandard,
} from "./labor.formulas";
import type { CalibrationReportResponse } from "./labor.types";

const DEFAULT_CALIBRATION_DAYS = 60;

/** Same anomaly filter getKitchenAnalyticsService and getEtaPredictionService already apply — a ticket left open overnight is a data error, not a slow cook. */
const MAX_ORDER_MINUTES = 300;

const round2 = (n: number) => Math.round(n * 100) / 100;

const median = (values: number[]): number => {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Strip the systematic component out of the raw calibration factors.
 *
 * Every raw factor carries the same two biases — queue wait inflates durations,
 * parallel cooking deflates them relative to summed labor minutes — and both
 * apply roughly equally to every item. Dividing through by the median removes
 * that shared component and leaves the part that is genuinely about the item:
 * "biryani runs 30% longer than your standard RELATIVE to everything else on
 * the menu". Without this step the engine would drift every standard in the
 * same direction on every calibration run.
 */
const normaliseFactors = <T extends { factor: number }>(rows: T[]): T[] => {
  if (!rows.length) return rows;
  const centre = median(rows.map((r) => r.factor));
  if (!centre || centre <= 0) return rows;
  return rows.map((r) => ({ ...r, factor: round2(r.factor / centre) }));
};

// ─── Calibration report ───────────────────────────────────────────────────────

export const getCalibrationReportService = async (
  restaurantId: number,
  branchId: number,
  trailingDays: number = DEFAULT_CALIBRATION_DAYS,
  apply: boolean = false,
): Promise<CalibrationReportResponse> => {
  const since = new Date();
  since.setDate(since.getDate() - trailingDays);
  since.setHours(0, 0, 0, 0);

  const stations = await prisma.kitchenStation.findMany({
    where: { restaurantId, branchId, isActive: true },
    select: { id: true, code: true },
  });
  const stationIds = stations.map((s) => s.id);

  const [orders, standards] = await Promise.all([
    prisma.runningOrder.findMany({
      where: { restaurantId, branchId, completedAt: { not: null }, startedAt: { gte: since } },
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        batches: { select: { items: { select: { menuItemId: true, quantity: true } } } },
      },
    }),
    // Typed empty array on the skip branch: an untyped `[]` widens the
    // Promise.all tuple element to never[] and every later use of `standards`
    // fails to compile.
    stationIds.length
      ? prisma.menuItemStationTime.findMany({
          where: { stationId: { in: stationIds } },
          select: {
            menuItemId: true,
            stationId: true,
            standardMinutes: true,
            observedMinutes: true,
            observationCount: true,
          },
        })
      : ([] as StationTimeStandard[]),
  ]);

  // Per-unit predicted labor minutes for each item = Σ its station standards.
  const perUnitMinutes = new Map<number, number>();
  standards.forEach((s) => {
    const { minutes } = resolveEffectiveMinutes(s);
    perUnitMinutes.set(s.menuItemId, (perUnitMinutes.get(s.menuItemId) ?? 0) + minutes);
  });

  const timed = orders
    .map((o) => ({
      id: o.id,
      startMs: new Date(o.startedAt).getTime(),
      endMs: new Date(o.completedAt as Date).getTime(),
      items: o.batches.flatMap((b) => b.items),
    }))
    .filter((o) => {
      const mins = (o.endMs - o.startMs) / 60000;
      return mins > 0 && mins < MAX_ORDER_MINUTES;
    });

  const concurrency = computeOrderConcurrency(
    timed.map((o) => ({ id: o.id, startMs: o.startMs, endMs: o.endMs })),
  );

  const observations: CalibrationObservation[] = timed.map((o) => {
    const items = o.items
      .filter((i) => i.menuItemId != null && (perUnitMinutes.get(i.menuItemId as number) ?? 0) > 0)
      .map((i) => ({
        menuItemId: i.menuItemId as number,
        predictedMinutes: (perUnitMinutes.get(i.menuItemId as number) as number) * (Number(i.quantity) || 0),
      }));
    return {
      actualMinutes: (o.endMs - o.startMs) / 60000,
      concurrency: concurrency.get(o.id) ?? 0,
      items,
    };
  });

  const usable = observations.filter(
    (o) => o.concurrency <= MAX_CONCURRENCY_FOR_CALIBRATION && o.items.length > 0,
  );

  const rawFactors = computeItemCalibrationFactors(observations);
  const factors = normaliseFactors(rawFactors);

  // Item names for display, and the per-station breakdown of what each factor
  // would change.
  const itemIds = factors.map((f) => f.menuItemId);
  const items = itemIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(items.map((i) => [i.id, i.name]));
  const codeById = new Map(stations.map((s) => [s.id, s.code]));

  const standardsByItem = new Map<number, typeof standards>();
  standards.forEach((s) => {
    const list = standardsByItem.get(s.menuItemId);
    if (list) list.push(s);
    else standardsByItem.set(s.menuItemId, [s]);
  });

  const reportItems = factors
    .map((f) => {
      const itemStandards = standardsByItem.get(f.menuItemId) ?? [];
      return {
        menuItemId: f.menuItemId,
        itemName: nameById.get(f.menuItemId) ?? `Item ${f.menuItemId}`,
        factor: f.factor,
        observationCount: f.observationCount,
        stations: itemStandards.map((s) => ({
          stationId: s.stationId,
          code: codeById.get(s.stationId) ?? "",
          standardMinutes: s.standardMinutes,
          suggestedMinutes: round2(s.standardMinutes * f.factor),
          observedMinutes: s.observedMinutes,
          observationCount: s.observationCount,
        })),
      };
    })
    // Biggest corrections first — those are the standards worth an owner's
    // attention, and a factor of ~1.0 means the entered standard was right.
    .sort((a, b) => Math.abs(b.factor - 1) - Math.abs(a.factor - 1));

  if (apply) {
    // observedMinutes is written; standardMinutes is never touched. The engine
    // only trusts observedMinutes once observationCount clears
    // MIN_OBSERVATIONS_TO_TRUST (see resolveEffectiveMinutes), so applying a
    // thin calibration is safe — it records the measurement without yet acting
    // on it.
    const now = new Date();
    const writes = reportItems.flatMap((item) =>
      item.stations.map(
        (s) =>
          (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) =>
            tx.menuItemStationTime.update({
              where: { menuItemId_stationId: { menuItemId: item.menuItemId, stationId: s.stationId } },
              data: {
                observedMinutes: s.suggestedMinutes,
                observationCount: item.observationCount,
                lastObservedAt: now,
              },
            }),
      ),
    );
    // Chunked for the same reason as the standards writes — see labor.batch.ts.
    await runChunkedWrites(writes);
  }

  const staffThroughput = await getStaffThroughputContext(branchId, since, timed);

  return {
    branchId,
    trailingDays,
    ordersConsidered: timed.length,
    ordersUsable: usable.length,
    maxConcurrencyUsed: MAX_CONCURRENCY_FOR_CALIBRATION,
    applied: apply,
    items: reportItems,
    staffThroughput,
    staffThroughputCaveat:
      "Orders completed while a person was clocked in — NOT work attributed to them. Nothing in the POS records which cook prepared which item, so everyone on the same shift is credited with the same orders. Treat this as context for who works the busy shifts, never as an individual speed rating, and set speedFactor in the skill matrix from your own observation instead.",
  };
};

// ─── Per-employee throughput context (correlational) ──────────────────────────

const getStaffThroughputContext = async (
  branchId: number,
  since: Date,
  completedOrders: { endMs: number }[],
): Promise<CalibrationReportResponse["staffThroughput"]> => {
  const attendance = await prisma.attendance.findMany({
    where: {
      branchId,
      date: { gte: since },
      loginTime: { not: null },
      logoutTime: { not: null },
    },
    select: {
      userId: true,
      loginTime: true,
      logoutTime: true,
      totalHours: true,
      manualTotalHours: true,
      user: { select: { id: true, name: true } },
    },
  });

  if (!attendance.length) return [];

  const orderEndTimes = completedOrders.map((o) => o.endMs).sort((a, b) => a - b);

  // Binary search bounds rather than a scan per shift — a 60-day window can
  // hold thousands of orders and hundreds of shifts.
  const countInRange = (startMs: number, endMs: number): number => {
    const lowerBound = (target: number) => {
      let lo = 0;
      let hi = orderEndTimes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (orderEndTimes[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    return lowerBound(endMs) - lowerBound(startMs);
  };

  const byUser = new Map<number, { name: string; hours: number; orders: number }>();
  attendance.forEach((a) => {
    const start = new Date(a.loginTime as Date).getTime();
    const end = new Date(a.logoutTime as Date).getTime();
    if (end <= start) return;
    // manualTotalHours wins when set, matching the payroll convention in
    // Attendance's own comment (owner override beats the clock).
    const hours = a.manualTotalHours ?? a.totalHours ?? (end - start) / 3_600_000;
    if (!hours || hours <= 0) return;

    const entry = byUser.get(a.userId) ?? { name: a.user?.name ?? `Staff ${a.userId}`, hours: 0, orders: 0 };
    entry.hours += hours;
    entry.orders += countInRange(start, end);
    byUser.set(a.userId, entry);
  });

  const rows = [...byUser.entries()].map(([userId, v]) => ({
    userId,
    name: v.name,
    hoursOnShift: round2(v.hours),
    ordersCompletedDuringShift: v.orders,
    ordersPerHour: round2(v.hours > 0 ? v.orders / v.hours : 0),
  }));

  const branchAverage = rows.length
    ? round2(rows.reduce((s, r) => s + r.ordersPerHour, 0) / rows.length)
    : 0;

  return rows
    .map((r) => ({
      ...r,
      branchAverageOrdersPerHour: branchAverage,
      relativeIndex: round2(branchAverage > 0 ? r.ordersPerHour / branchAverage : 1),
    }))
    .sort((a, b) => b.ordersPerHour - a.ordersPerHour);
};
