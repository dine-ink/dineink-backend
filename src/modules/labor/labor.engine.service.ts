// Labor & Kitchen Capacity Engine — the analysis pipeline.
//
//   POS order history (RunningOrder + batch items)
//        ↓  item-level demand, in 15-minute buckets, averaged per day
//   optional forecast scaling (reuses getPeakHourForecastService's trend)
//        ↓  labor standards (MenuItemStationTime)
//   per-station workload minutes
//        ↓  rolling windows → the peak window that actually drives staffing
//   required FTE per station  ← capped by station/equipment throughput ceiling
//        ↓  skill matrix (StaffStationSkill) + who is on the roster
//   crew allocation across stations (people can cover more than one)
//        ↓
//   per-station constraint + one branch-level verdict + labor cost
//
// Every number is produced by a pure function in labor.formulas.ts; this file
// only fetches, shapes, and sequences. Deterministic throughout — no LLM, no
// fitted model, same stance as ai.service.ts and peakHour.formulas.ts.

import prisma from "../../config/prisma";
import { computeStandardShiftHours } from "../finance/finance.formulas";
import { getPeakHourForecastService } from "../forecast/forecast.service";
import {
  DEFAULT_UTILIZATION_FACTOR,
  MATERIAL_FTE_SHORTFALL,
  allocateCrewToStations,
  assessEquipmentCapacity,
  classifyStationConstraint,
  computePooledHeadcount,
  computeProductiveMinutesPerStaff,
  computeRequiredFte,
  computeRollingWindowPeak,
  computeStationWorkloads,
  computeWindowLaborCost,
  summarizeCapacityVerdict,
  type CrewMember,
  type ItemDemand,
  type StationConstraint,
} from "./labor.formulas";
import { listStationsService } from "./labor.service";
import type { StaffingPlanResponse, StationPlanRow, WorkloadBucket } from "./labor.types";

/** Resolution of the intra-window demand series. 15 minutes is the smallest slice a manager can act on (you cannot move someone between stations for 5 minutes) and is fine enough to expose a rush inside a calm hour. */
const BUCKET_MINUTES = 15;

/** Rolling windows reported, in minutes. */
const ROLLING_WINDOWS = [15, 30, 60, 90];

/** Default planning window. 60 minutes is the conventional planning horizon — see pickDrivingWindow for why the engine does not simply staff to the sharpest burst it can find. */
const DEFAULT_PLAN_WINDOW_MINUTES = 60;

/** Trailing history used to establish the item mix and arrival shape. */
const DEFAULT_TRAILING_DAYS = 30;

const HOUR_LABEL = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;

const CLOCK_LABEL = (minutesFromMidnight: number) => {
  const total = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StaffingPlanOptions {
  fromHour: number;
  toHour: number;
  trailingDays: number;
  /** "FORECAST" scales the historical item mix by the peak-hour forecast's trend; "HISTORICAL" reports the trailing average untouched. */
  basis: "FORECAST" | "HISTORICAL";
  planWindowMinutes: number;
  /** Overrides the roster with a hypothetical headcount — the "what if I schedule 8 instead of 6?" question. */
  assumedHeadcount: number | null;
}

export const DEFAULT_PLAN_OPTIONS: StaffingPlanOptions = {
  fromHour: 18,
  toHour: 22,
  trailingDays: DEFAULT_TRAILING_DAYS,
  basis: "FORECAST",
  planWindowMinutes: DEFAULT_PLAN_WINDOW_MINUTES,
  assumedHeadcount: null,
};

// ─── Driving-window choice ────────────────────────────────────────────────────

/**
 * Which rolling window the staffing requirement is solved against.
 *
 * Tempting but wrong: pick whichever window has the highest per-hour load. That
 * is almost always the 15-minute one, because demand is bursty — and staffing a
 * whole shift to a 15-minute spike is exactly the over-hiring this engine is
 * supposed to prevent. So the caller's planning window (default 60 min) is
 * honoured, and burstiness is reported separately as a warning rather than
 * silently inflating headcount.
 */
const pickDrivingWindow = (requested: number): number => {
  const supported = ROLLING_WINDOWS.filter((w) => w <= requested);
  return supported.length ? Math.max(...supported) : ROLLING_WINDOWS[0];
};

// ─── Demand extraction ────────────────────────────────────────────────────────

interface DemandExtract {
  /** Average per-day item demand across the requested hour window. */
  itemDemand: ItemDemand[];
  /** Per-bucket item mix (already averaged per day), index-aligned with bucketOrders. */
  bucketItemDemand: ItemDemand[][];
  bucketOrders: number[];
  bucketOffsets: number[];
  daysWithData: number;
  ordersObserved: number;
  expectedOrders: number;
  /** Peak count of dine-in tables occupied simultaneously anywhere in the window. */
  peakTablesOccupied: number;
}

const extractDemand = (
  orders: {
    id: number;
    startedAt: Date;
    completedAt: Date | null;
    tableId: number | null;
    batches: { items: { menuItemId: number | null; itemName: string; quantity: number }[] }[];
  }[],
  fromHour: number,
  toHour: number,
): DemandExtract => {
  const windowStartMinutes = fromHour * 60;
  const windowEndMinutes = (toHour + 1) * 60; // toHour is inclusive
  const bucketCount = Math.max(1, Math.round((windowEndMinutes - windowStartMinutes) / BUCKET_MINUTES));

  const inWindow = orders.filter((o) => {
    const h = new Date(o.startedAt).getHours();
    return h >= fromHour && h <= toHour;
  });

  const days = new Set(inWindow.map((o) => new Date(o.startedAt).toDateString()));
  // Never divide by zero, and never divide by a day count of 0 dressed up as 1
  // — daysWithData is returned so the caller can judge the sample itself.
  const daysWithData = days.size;
  const divisor = Math.max(1, daysWithData);

  const totalByItem = new Map<number, { itemName: string; quantity: number }>();
  const bucketByItem: Map<number, { itemName: string; quantity: number }>[] = Array.from(
    { length: bucketCount },
    () => new Map(),
  );
  const bucketOrderCounts = new Array(bucketCount).fill(0);

  inWindow.forEach((o) => {
    const started = new Date(o.startedAt);
    const minutesFromMidnight = started.getHours() * 60 + started.getMinutes();
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((minutesFromMidnight - windowStartMinutes) / BUCKET_MINUTES)),
    );
    bucketOrderCounts[bucketIndex] += 1;

    o.batches.forEach((b) =>
      b.items.forEach((item) => {
        // menuItemId is nullable (the item may have been deleted from the menu
        // since). Such rows cannot be joined to a labor standard, so they are
        // skipped here and surface as missing demand coverage rather than
        // being silently counted as zero-workload.
        if (item.menuItemId == null) return;
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) return;

        const total = totalByItem.get(item.menuItemId) ?? { itemName: item.itemName, quantity: 0 };
        total.quantity += qty;
        totalByItem.set(item.menuItemId, total);

        const bucketEntry =
          bucketByItem[bucketIndex].get(item.menuItemId) ?? { itemName: item.itemName, quantity: 0 };
        bucketEntry.quantity += qty;
        bucketByItem[bucketIndex].set(item.menuItemId, bucketEntry);
      }),
    );
  });

  // Peak simultaneous table occupancy inside the window — the basis for the
  // "add seating" judgement. Deliberately computed here rather than reusing
  // getTableOperationsService's seatUtilizationPercentage: that figure spreads
  // occupancy across the whole 12-hour trading day, so a dining room that is
  // completely full every evening still reads as ~30% utilized. A peak-window
  // occupancy count is the only version of this number that can support a
  // "you need more tables" recommendation.
  const tableEvents: { at: number; delta: number }[] = [];
  inWindow.forEach((o) => {
    if (o.tableId == null) return;
    const start = new Date(o.startedAt).getTime();
    const end = o.completedAt ? new Date(o.completedAt).getTime() : null;
    if (!end || end <= start) return;
    tableEvents.push({ at: start, delta: 1 }, { at: end, delta: -1 });
  });
  tableEvents.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let peakTablesOccupied = 0;
  tableEvents.forEach((e) => {
    open += e.delta;
    if (open > peakTablesOccupied) peakTablesOccupied = open;
  });

  return {
    itemDemand: [...totalByItem.entries()].map(([menuItemId, v]) => ({
      menuItemId,
      itemName: v.itemName,
      quantity: round2(v.quantity / divisor),
    })),
    bucketItemDemand: bucketByItem.map((m) =>
      [...m.entries()].map(([menuItemId, v]) => ({
        menuItemId,
        itemName: v.itemName,
        quantity: v.quantity / divisor,
      })),
    ),
    bucketOrders: bucketOrderCounts.map((c) => round2(c / divisor)),
    bucketOffsets: Array.from({ length: bucketCount }, (_, i) => windowStartMinutes + i * BUCKET_MINUTES),
    daysWithData,
    ordersObserved: inWindow.length,
    expectedOrders: round1(inWindow.length / divisor),
    peakTablesOccupied,
  };
};

// ─── Confidence ───────────────────────────────────────────────────────────────

const assessConfidence = (
  daysWithData: number,
  ordersObserved: number,
  standardsCoveragePercent: number,
): { confidence: "high" | "medium" | "low"; reasons: string[] } => {
  const reasons: string[] = [];
  let score = 0;

  if (daysWithData >= 21) {
    score += 2;
    reasons.push(`${daysWithData} days of history in this time window`);
  } else if (daysWithData >= 7) {
    score += 1;
    reasons.push(`Only ${daysWithData} days of history in this time window`);
  } else {
    reasons.push(`Just ${daysWithData} day(s) of history in this time window — one unusual evening moves the whole plan`);
  }

  if (ordersObserved >= 100) {
    score += 2;
    reasons.push(`${ordersObserved} orders observed`);
  } else if (ordersObserved >= 30) {
    score += 1;
    reasons.push(`${ordersObserved} orders observed`);
  } else {
    reasons.push(`Only ${ordersObserved} orders observed in this window`);
  }

  // Coverage matters more than sample size: a perfect 90-day sample of items
  // that have no labor standards produces a confidently wrong zero.
  if (standardsCoveragePercent >= 90) {
    score += 2;
    reasons.push(`${Math.round(standardsCoveragePercent)}% of demand has station labor standards`);
  } else if (standardsCoveragePercent >= 60) {
    score += 1;
    reasons.push(`${Math.round(standardsCoveragePercent)}% of demand has station labor standards — the rest is invisible to this plan`);
  } else {
    reasons.push(`Only ${Math.round(standardsCoveragePercent)}% of demand has station labor standards — most of the kitchen's workload is not modelled yet`);
  }

  return { confidence: score >= 5 ? "high" : score >= 3 ? "medium" : "low", reasons };
};

// ─── Main: staffing plan ──────────────────────────────────────────────────────

export const getStaffingPlanService = async (
  restaurantId: number,
  branchId: number,
  opts: Partial<StaffingPlanOptions> = {},
): Promise<StaffingPlanResponse> => {
  const options: StaffingPlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...opts };
  const { fromHour, toHour, trailingDays, basis, assumedHeadcount } = options;

  const since = new Date();
  since.setDate(since.getDate() - trailingDays);
  since.setHours(0, 0, 0, 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [branch, stations, orders, staff, clockedInToday, totalTables] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        staffUtilizationFactor: true,
        targetTicketMinutes: true,
        kitchenCapacityPerHour: true,
        morningShiftHours: true,
        eveningShiftHours: true,
        fullDayShiftHours: true,
      },
    }),
    listStationsService(restaurantId, branchId),
    prisma.runningOrder.findMany({
      where: { restaurantId, branchId, startedAt: { gte: since } },
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        tableId: true,
        batches: { select: { items: { select: { menuItemId: true, itemName: true, quantity: true } } } },
      },
    }),
    prisma.user.findMany({
      where: { restaurantId, branchId, isActive: true, isDeleted: false },
      select: {
        id: true,
        name: true,
        shift: true,
        salary: true,
        stationSkills: { select: { stationId: true, proficiency: true, speedFactor: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: { branchId, date: { gte: todayStart, lte: todayEnd }, loginTime: { not: null } },
      select: { userId: true },
    }),
    prisma.restaurantTable.count({ where: { branchId } }),
  ]);

  const stationIds = stations.map((s) => s.stationId);
  const standards = stationIds.length
    ? await prisma.menuItemStationTime.findMany({
        where: { stationId: { in: stationIds } },
        select: {
          menuItemId: true,
          stationId: true,
          standardMinutes: true,
          observedMinutes: true,
          observationCount: true,
        },
      })
    : [];

  const branchUtilization = branch?.staffUtilizationFactor ?? DEFAULT_UTILIZATION_FACTOR;
  const windowMinutes = (toHour - fromHour + 1) * 60;
  const windowLabel = `${HOUR_LABEL(fromHour)} – ${HOUR_LABEL(toHour === 23 ? 0 : toHour + 1)}`;

  const demand = extractDemand(orders, fromHour, toHour);

  // ── Forecast scaling ──
  // The item MIX comes from trailing history; only the VOLUME is scaled, by the
  // trend the existing peak-hour forecast already computed. Reusing that rather
  // than fitting a second, competing trend here means the Forecasting page and
  // this page can never disagree about which direction demand is moving.
  let demandScale = 1;
  let forecastNote: string | null = null;
  if (basis === "FORECAST") {
    try {
      const peak = await getPeakHourForecastService(restaurantId, branchId, "NEXT_MONTH", "HISTORICAL_TREND");
      if (peak?.variancePercentage != null && Number.isFinite(peak.variancePercentage)) {
        // Clamped: a forecast off a thin history can produce extreme variance,
        // and a 4x staffing plan from one noisy month is worse than no plan.
        demandScale = Math.min(1.5, Math.max(0.5, 1 + peak.variancePercentage / 100));
        forecastNote = `Volume scaled ${demandScale >= 1 ? "up" : "down"} ${Math.abs(Math.round((demandScale - 1) * 100))}% by the peak-hour forecast trend`;
      }
    } catch {
      // A forecast failure degrades to the historical average rather than
      // failing the whole plan — the trailing average is still useful.
      forecastNote = "Peak-hour forecast unavailable — using the trailing historical average unscaled";
    }
  }

  const scaledItemDemand: ItemDemand[] = demand.itemDemand.map((d) => ({
    ...d,
    quantity: round2(d.quantity * demandScale),
  }));

  // ── Workload ──
  const workloads = computeStationWorkloads(scaledItemDemand, standards);
  const workloadByStation = new Map(workloads.map((w) => [w.stationId, w]));

  const itemsWithStandards = new Set(standards.map((s) => s.menuItemId));
  const itemsMissingStandards = scaledItemDemand
    .filter((d) => !itemsWithStandards.has(d.menuItemId) && d.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  const totalDemandUnits = scaledItemDemand.reduce((s, d) => s + d.quantity, 0);
  const missingUnits = itemsMissingStandards.reduce((s, d) => s + d.quantity, 0);
  const coveragePercent =
    totalDemandUnits > 0 ? round1(((totalDemandUnits - missingUnits) / totalDemandUnits) * 100) : 0;

  // ── Per-bucket workload, for rolling windows and the chart ──
  // Item units are tracked per bucket alongside minutes so the equipment check
  // can use the units that actually pass through the station DURING the peak
  // window, rather than pro-rating the whole window's units by its share of
  // workload minutes — that shortcut assumes a constant item mix across the
  // window, and it feeds the equipment verdict, which is the one number an
  // owner might spend money on.
  const perBucketStationMinutes: Map<number, number>[] = [];
  const perBucketStationUnits: Map<number, number>[] = [];
  demand.bucketItemDemand.forEach((bucketDemand) => {
    const scaled = bucketDemand.map((d) => ({ ...d, quantity: d.quantity * demandScale }));
    const bucketWorkloads = computeStationWorkloads(scaled, standards);
    perBucketStationMinutes.push(new Map(bucketWorkloads.map((w) => [w.stationId, w.workloadMinutes])));
    perBucketStationUnits.push(new Map(bucketWorkloads.map((w) => [w.stationId, w.itemUnits])));
  });

  const buckets: WorkloadBucket[] = demand.bucketOffsets.map((offsetMinutes, i) => {
    const perStation: Record<number, number> = {};
    let total = 0;
    perBucketStationMinutes[i].forEach((minutes, stationId) => {
      perStation[stationId] = round1(minutes);
      total += minutes;
    });
    return {
      offsetMinutes,
      label: CLOCK_LABEL(offsetMinutes),
      orders: round2(demand.bucketOrders[i] * demandScale),
      workloadMinutes: round1(total),
      perStation,
    };
  });

  const totalSeries = buckets.map((b) => b.workloadMinutes);
  const rollingWindows = ROLLING_WINDOWS.map((w) => {
    const peak = computeRollingWindowPeak(totalSeries, BUCKET_MINUTES, w);
    if (!peak) return null;
    return {
      windowMinutes: peak.windowMinutes,
      label: `${CLOCK_LABEL(demand.bucketOffsets[0] + peak.startOffsetMinutes)} – ${CLOCK_LABEL(demand.bucketOffsets[0] + peak.startOffsetMinutes + peak.windowMinutes)}`,
      startOffsetMinutes: demand.bucketOffsets[0] + peak.startOffsetMinutes,
      workloadMinutes: peak.peakValue,
      workloadMinutesPerHour: peak.peakValuePerHour,
    };
  }).filter((w): w is NonNullable<typeof w> => w !== null);

  const drivingWindowMinutes = pickDrivingWindow(Math.min(options.planWindowMinutes, windowMinutes));
  const drivingWindow = rollingWindows.find((w) => w.windowMinutes === drivingWindowMinutes) ?? rollingWindows[rollingWindows.length - 1] ?? null;

  // ── Per-station requirement, solved against the peak driving window ──
  const stationRows: StationPlanRow[] = stations.map((station) => {
    const series = perBucketStationMinutes.map((m) => m.get(station.stationId) ?? 0);
    const stationPeak = computeRollingWindowPeak(series, BUCKET_MINUTES, drivingWindowMinutes);
    const peakWorkloadMinutes = stationPeak?.peakValue ?? 0;
    const effectiveWindowMinutes = stationPeak?.windowMinutes ?? drivingWindowMinutes;

    const utilizationFactorUsed = station.utilizationFactor ?? branchUtilization ?? DEFAULT_UTILIZATION_FACTOR;
    const productiveMinutesPerStaff = computeProductiveMinutesPerStaff(effectiveWindowMinutes, utilizationFactorUsed);
    const rawRequiredFte = computeRequiredFte(peakWorkloadMinutes, productiveMinutesPerStaff);

    // Items/hour through this station over exactly the same bucket range the
    // workload peak was found in — the rate an equipment ceiling is expressed
    // in.
    const totalWorkload = workloadByStation.get(station.stationId);
    const peakSpanBuckets = Math.max(1, Math.round(effectiveWindowMinutes / BUCKET_MINUTES));
    const peakStartBucket = stationPeak?.startBucket ?? 0;
    let windowItemUnits = 0;
    for (let i = peakStartBucket; i < Math.min(peakStartBucket + peakSpanBuckets, perBucketStationUnits.length); i++) {
      windowItemUnits += perBucketStationUnits[i].get(station.stationId) ?? 0;
    }
    const demandItemsPerHour = effectiveWindowMinutes > 0 ? (windowItemUnits * 60) / effectiveWindowMinutes : 0;

    const equipment = assessEquipmentCapacity(demandItemsPerHour, {
      capacityPerHour: station.capacityPerHour,
      equipmentItemsPerHour: station.equipmentItemsPerHour,
    });

    // Staffing past what the equipment can produce is money spent on output
    // that physically cannot happen — so the recommendation is capped, and the
    // unservable remainder is reported as an equipment problem instead.
    const requiredFte = round2(rawRequiredFte * equipment.servableFraction);

    return {
      stationId: station.stationId,
      code: station.code,
      name: station.name,
      workloadMinutes: peakWorkloadMinutes,
      itemUnits: round2(windowItemUnits),
      utilizationFactorUsed,
      productiveMinutesPerStaff,
      rawRequiredFte,
      requiredFte,
      recommendedHeadcount: Math.ceil(requiredFte - 0.001) || 0,
      coveredFte: 0,
      shortfallFte: 0,
      headcount: 0,
      constraint: "IDLE" as StationConstraint,
      capacityPerHour: equipment.capacityPerHour,
      equipmentUtilizationPercent: equipment.utilizationPercent,
      unservableItemsPerHour: equipment.unservableItemsPerHour,
      isEquipmentBound: equipment.isEquipmentBound,
      anyoneSkilled: false,
      topContributors: (totalWorkload?.contributors ?? []).slice(0, 5),
    };
  });

  // ── Crew ──
  // SCHEDULED when somebody has actually clocked in today (same today-range,
  // loginTime-not-null filter ai.service.ts already uses for "currently
  // scheduled/active"); otherwise a roster of everyone marked able to work at
  // least one station, labelled ASSUMED so the UI never presents a hypothetical
  // as a real shift.
  const clockedInIds = new Set(clockedInToday.map((a) => a.userId));
  const kitchenCapableStaff = staff.filter((s) => s.stationSkills.length > 0);
  const scheduledStaff = staff.filter((s) => clockedInIds.has(s.id) && s.stationSkills.length > 0);

  let crewBasis: "SCHEDULED" | "ASSUMED" = scheduledStaff.length > 0 ? "SCHEDULED" : "ASSUMED";
  let rosteredStaff = crewBasis === "SCHEDULED" ? scheduledStaff : kitchenCapableStaff;

  if (assumedHeadcount != null) {
    // A hypothetical headcount takes the most-skilled N of the roster rather
    // than inventing generic bodies — a plan built on staff who can't work the
    // short station would be misleading.
    crewBasis = "ASSUMED";
    rosteredStaff = [...kitchenCapableStaff]
      .sort((a, b) => b.stationSkills.length - a.stationSkills.length || a.id - b.id)
      .slice(0, assumedHeadcount);
  }

  const crew: CrewMember[] = rosteredStaff.map((s) => ({
    userId: s.id,
    name: s.name,
    availableFte: 1,
    skills: s.stationSkills.map((k) => ({
      stationId: k.stationId,
      proficiency: k.proficiency,
      speedFactor: k.speedFactor,
    })),
  }));

  const allocation = allocateCrewToStations(
    stationRows.map((r) => ({ stationId: r.stationId, requiredFte: r.requiredFte })),
    crew,
  );
  const allocByStation = new Map(allocation.perStation.map((p) => [p.stationId, p]));

  stationRows.forEach((row) => {
    const alloc = allocByStation.get(row.stationId);
    row.coveredFte = alloc?.coveredFte ?? 0;
    row.shortfallFte = alloc?.shortfallFte ?? 0;
    row.headcount = alloc?.headcount ?? 0;
    row.anyoneSkilled = crew.some((c) => c.skills.some((k) => k.stationId === row.stationId));
    row.constraint = classifyStationConstraint({
      requiredFte: row.requiredFte,
      shortfallFte: row.shortfallFte,
      isEquipmentBound: row.isEquipmentBound,
      anyoneSkilled: row.anyoneSkilled,
    });
  });

  // ── Seating: peak table occupancy, not the day-long seat-utilization proxy ──
  const peakTableUtilizationPercent =
    totalTables > 0 ? Math.min(100, round1((demand.peakTablesOccupied / totalTables) * 100)) : null;

  // "Is there anything to reason about?" — stations existing is not enough; they
  // need labor standards feeding them actual workload. Without this the verdict
  // would report an unconfigured branch as BALANCED (see VerdictInput's comment).
  const hasModelledWorkload = stationRows.some((r) => r.workloadMinutes > 0);

  const verdict = summarizeCapacityVerdict({
    stations: stationRows.map((r) => ({
      stationId: r.stationId,
      code: r.code,
      name: r.name,
      constraint: r.constraint,
      shortfallFte: r.shortfallFte,
      unservableItemsPerHour: r.unservableItemsPerHour,
    })),
    totalSurplusFte: allocation.totalSurplusFte,
    seatUtilizationPercent: peakTableUtilizationPercent,
    hasModelledWorkload,
  });

  // ── Labor cost of the plan as allocated ──
  const salaryById = new Map(staff.map((s) => [s.id, { salary: s.salary ?? 0, shift: s.shift }]));
  const payrollPolicy = {
    morningShiftHours: branch?.morningShiftHours ?? 6,
    eveningShiftHours: branch?.eveningShiftHours ?? 6,
    fullDayShiftHours: branch?.fullDayShiftHours ?? 10,
  };
  const costableCrew = allocation.assignments
    .map((a) => {
      const s = salaryById.get(a.userId);
      if (!s || !s.salary) return null;
      const assignedFraction = a.stations.reduce((sum, st) => sum + st.fractionOfWindow, 0);
      return {
        monthlySalary: s.salary,
        standardShiftHours: computeStandardShiftHours(s.shift, payrollPolicy),
        fractionOfWindow: assignedFraction,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  // Null rather than 0 when no rostered person has a salary on record — a
  // confident ₹0 would read as "this shift is free".
  const estimatedWindowLaborCost = costableCrew.length
    ? computeWindowLaborCost(costableCrew, drivingWindowMinutes)
    : null;

  // Pooled, NOT the sum of per-station recommendedHeadcount values — see
  // computePooledHeadcount. StationPlanRow.recommendedHeadcount stays per-station
  // (it is what the "Grill — 3" line needs), but summing those would overstate
  // the crew by a person per rounding tail.
  const recommendedHeadcount = computePooledHeadcount(stationRows.map((r) => r.requiredFte));
  const stationNameById = new Map(stationRows.map((r) => [r.stationId, r]));

  // ── Actions ──
  const actions: string[] = [];
  stationRows
    .filter((r) => r.isEquipmentBound)
    .sort((a, b) => b.unservableItemsPerHour - a.unservableItemsPerHour)
    .forEach((r) => {
      actions.push(
        r.unservableItemsPerHour > 0
          ? `${r.name}: add throughput (second unit, faster equipment, or cap availability) — ${r.unservableItemsPerHour} items/hr of demand cannot be produced.`
          : `${r.name}: running at ${r.equipmentUtilizationPercent}% of its throughput ceiling — any demand growth here will queue.`,
      );
    });

  // Idle-time reallocation named person-by-person, since "move 1 prep to grill"
  // is the only form of this advice a manager can act on immediately.
  //
  // Capped at the worst few stations: when the whole kitchen is short, emitting
  // one near-identical "schedule an extra person" line per station produces ten
  // lines of noise that bury the two that matter. The remainder is rolled into a
  // single summary line rather than silently dropped.
  const MAX_STATION_ACTIONS = 3;
  const shortStations = stationRows
    .filter((r) => r.shortfallFte > MATERIAL_FTE_SHORTFALL && !r.isEquipmentBound)
    .sort((a, b) => b.shortfallFte - a.shortfallFte);
  const idleCrew = allocation.assignments.filter((a) => a.idleFraction > 0.2);

  shortStations.slice(0, MAX_STATION_ACTIONS).forEach((r) => {
    const helper = idleCrew.find((a) =>
      crew.find((c) => c.userId === a.userId)?.skills.some((k) => k.stationId === r.stationId),
    );
    if (helper) {
      actions.push(
        `Move ${helper.name} to ${r.name} for ${Math.round(Math.min(helper.idleFraction, r.shortfallFte) * drivingWindowMinutes)} min during ${drivingWindow?.label ?? windowLabel} — they have ${Math.round(helper.idleFraction * 100)}% of the window free and are trained on it.`,
      );
    } else if (!r.anyoneSkilled) {
      actions.push(`${r.name}: nobody on this roster is marked able to work it — train someone or roster a specialist.`);
    } else {
      actions.push(
        `${r.name}: short ${r.shortfallFte} staff-equivalents (${Math.round(r.shortfallFte * drivingWindowMinutes)} labor minutes) during ${drivingWindow?.label ?? windowLabel} — schedule an extra person.`,
      );
    }
  });

  if (shortStations.length > MAX_STATION_ACTIONS) {
    const rest = shortStations.slice(MAX_STATION_ACTIONS);
    actions.push(
      `${rest.length} further station(s) are also short (${rest.map((r) => `${r.name} ${r.shortfallFte}`).join(", ")} FTE) — the whole kitchen is under-staffed for this window, not one section.`,
    );
  }

  // Burstiness: the reason a 60-minute plan can still produce a queue.
  const shortest = rollingWindows.find((w) => w.windowMinutes === 15);
  const driving = drivingWindow;
  if (shortest && driving && driving.workloadMinutesPerHour > 0) {
    const burstRatio = shortest.workloadMinutesPerHour / driving.workloadMinutesPerHour;
    if (burstRatio >= 1.3) {
      actions.push(
        `Demand arrives in bursts: the busiest 15 minutes (${shortest.label}) runs at ${Math.round(burstRatio * 100)}% of the ${driving.windowMinutes}-minute average this plan is built for. Expect a queue there even when the hour is adequately staffed.`,
      );
    }
  }

  if (itemsMissingStandards.length) {
    actions.push(
      `Add station labor standards for ${itemsMissingStandards.length} item(s) with demand but no standards (largest: ${itemsMissingStandards.slice(0, 3).map((i) => i.itemName).join(", ")}) — their workload is currently invisible to this plan.`,
    );
  }

  // ── Setup warnings ──
  const setupWarnings: string[] = [];
  if (!stations.length) {
    setupWarnings.push("No kitchen stations defined for this branch — add stations before this plan can compute anything.");
  }
  if (stations.length && !standards.length) {
    setupWarnings.push("No labor standards entered — every station shows zero workload until menu items have per-station minutes.");
  }
  if (!crew.length) {
    setupWarnings.push("No staff are marked able to work any station, so no allocation could be made. Fill in the skill matrix.");
  }
  if (stations.length && !stations.some((s) => s.capacityPerHour || s.equipmentItemsPerHour)) {
    setupWarnings.push("No station has a throughput ceiling (or equipment with an items/hour rate), so equipment bottlenecks cannot be detected — only labor shortfalls.");
  }
  if (demand.daysWithData === 0) {
    setupWarnings.push(`No orders found between ${HOUR_LABEL(fromHour)} and ${HOUR_LABEL(toHour + 1 > 23 ? 0 : toHour + 1)} in the last ${trailingDays} days.`);
  }

  const { confidence, reasons } = assessConfidence(demand.daysWithData, demand.ordersObserved, coveragePercent);
  if (forecastNote) reasons.push(forecastNote);

  return {
    branchId,
    window: { fromHour, toHour, label: windowLabel, windowMinutes },
    source: {
      basis,
      trailingDays,
      daysWithData: demand.daysWithData,
      ordersObserved: demand.ordersObserved,
      confidence,
      confidenceReasons: reasons,
    },
    demand: {
      expectedOrders: round1(demand.expectedOrders * demandScale),
      expectedItems: round1(totalDemandUnits),
      itemsMissingStandards: itemsMissingStandards.slice(0, 10),
      coveragePercent,
    },
    peak: {
      windows: rollingWindows,
      drivingWindowMinutes,
      drivingWindowLabel: drivingWindow?.label ?? windowLabel,
    },
    stations: stationRows,
    crew: {
      basis: crewBasis,
      scheduledCount: crew.length,
      assignments: allocation.assignments.map((a) => ({
        userId: a.userId,
        name: a.name,
        stations: a.stations.map((s) => ({
          stationId: s.stationId,
          code: stationNameById.get(s.stationId)?.code ?? "",
          name: stationNameById.get(s.stationId)?.name ?? "",
          fractionOfWindow: s.fractionOfWindow,
          percentOfWindow: Math.round(s.fractionOfWindow * 100),
        })),
        idleFraction: a.idleFraction,
      })),
      totalShortfallFte: allocation.totalShortfallFte,
      totalSurplusFte: allocation.totalSurplusFte,
      unskilledShortfallFte: allocation.unskilledShortfallFte,
      recommendedHeadcount,
      shortByHeadcount: Math.max(0, recommendedHeadcount - crew.length),
      estimatedWindowLaborCost,
    },
    verdict: { ...verdict, actions },
    buckets,
    setupWarnings,
    hasModelledWorkload,
  };
};

// ─── Capacity sweep: every hour of the day, one row each ──────────────────────

/**
 * The whole trading day at a glance — required vs. rostered staff and the
 * binding constraint for each hour, so an owner can see WHEN the kitchen breaks
 * rather than only how badly. Runs the same per-hour math as the plan above but
 * skips crew allocation and cost, which are only meaningful for one specific
 * window at a time.
 */
export const getCapacitySweepService = async (
  restaurantId: number,
  branchId: number,
  trailingDays: number = DEFAULT_TRAILING_DAYS,
) => {
  const since = new Date();
  since.setDate(since.getDate() - trailingDays);
  since.setHours(0, 0, 0, 0);

  const [branch, stations, orders] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { staffUtilizationFactor: true },
    }),
    listStationsService(restaurantId, branchId),
    prisma.runningOrder.findMany({
      where: { restaurantId, branchId, startedAt: { gte: since } },
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        tableId: true,
        batches: { select: { items: { select: { menuItemId: true, itemName: true, quantity: true } } } },
      },
    }),
  ]);

  const stationIds = stations.map((s) => s.stationId);
  const standards = stationIds.length
    ? await prisma.menuItemStationTime.findMany({
        where: { stationId: { in: stationIds } },
        select: {
          menuItemId: true,
          stationId: true,
          standardMinutes: true,
          observedMinutes: true,
          observationCount: true,
        },
      })
    : [];

  const branchUtilization = branch?.staffUtilizationFactor ?? DEFAULT_UTILIZATION_FACTOR;

  const hours = Array.from({ length: 24 }, (_, hour) => {
    const demand = extractDemand(orders, hour, hour);
    const workloads = computeStationWorkloads(demand.itemDemand, standards);

    const perStation = stations.map((station) => {
      const w = workloads.find((x) => x.stationId === station.stationId);
      const workloadMinutes = w?.workloadMinutes ?? 0;
      const utilizationFactor = station.utilizationFactor ?? branchUtilization;
      const productive = computeProductiveMinutesPerStaff(60, utilizationFactor);
      const rawFte = computeRequiredFte(workloadMinutes, productive);
      const equipment = assessEquipmentCapacity(w?.itemUnits ?? 0, {
        capacityPerHour: station.capacityPerHour,
        equipmentItemsPerHour: station.equipmentItemsPerHour,
      });
      return {
        stationId: station.stationId,
        code: station.code,
        name: station.name,
        workloadMinutes,
        requiredFte: round2(rawFte * equipment.servableFraction),
        isEquipmentBound: equipment.isEquipmentBound,
        equipmentUtilizationPercent: equipment.utilizationPercent,
        unservableItemsPerHour: equipment.unservableItemsPerHour,
      };
    });

    const totalRequiredFte = round2(perStation.reduce((s, p) => s + p.requiredFte, 0));
    const busiest = [...perStation].sort((a, b) => b.requiredFte - a.requiredFte)[0] ?? null;
    const equipmentBound = perStation.filter((p) => p.isEquipmentBound);

    return {
      hour,
      label: HOUR_LABEL(hour),
      expectedOrders: demand.expectedOrders,
      daysWithData: demand.daysWithData,
      totalWorkloadMinutes: round1(perStation.reduce((s, p) => s + p.workloadMinutes, 0)),
      totalRequiredFte,
      recommendedHeadcount: computePooledHeadcount(perStation.map((p) => p.requiredFte)),
      busiestStationCode: busiest && busiest.requiredFte > 0 ? busiest.code : null,
      equipmentBoundStationCodes: equipmentBound.map((p) => p.code),
      perStation,
    };
  });

  const activeHours = hours.filter((h) => h.expectedOrders > 0);
  const peakHour = activeHours.length
    ? activeHours.reduce((best, h) => (h.totalRequiredFte > best.totalRequiredFte ? h : best), activeHours[0])
    : null;

  return {
    branchId,
    trailingDays,
    stations,
    hours,
    peakHour: peakHour ? { hour: peakHour.hour, label: peakHour.label, requiredFte: peakHour.totalRequiredFte, recommendedHeadcount: peakHour.recommendedHeadcount } : null,
  };
};
