// Live kitchen queue — the read behind the POS order-taking ETA ("if I add
// this dish now, how long until it's out?").
//
// Kept separate from labor.service.ts (config CRUD) and
// labor.engine.service.ts (forecast-horizon planning) because it answers a
// different question on a different clock: the engine reasons about a future
// window from forecast demand, this reasons about what is physically on the
// pass RIGHT NOW. Both share labor.formulas.ts so a minute means the same
// thing in each.
//
// WHAT THIS RETURNS, AND WHY IT'S SHAPED THIS WAY
// It returns the per-station backlog plus the raw item→station standards, NOT
// a per-menu-item ETA. The POS needs an estimate for every item a captain
// might tap, refreshed as the queue moves; computing all of them server-side
// would mean either a request per item or recomputing the whole menu every
// poll. The backlog is small and shared, so the client polls this once and
// derives each item's estimate locally.
//
// HONESTY RULES (deliberate, mirrors summarizeCapacityVerdict's NOT_CONFIGURED
// stance in labor.formulas.ts)
// A captain quotes this number to a customer, so a wrong number is worse than
// no number. When stations or labor standards don't exist for this branch,
// `configured` comes back false with a reason and the POS falls back to the
// menu item's own prepTime with no queue adjustment — it never guesses a
// ceiling or a headcount to manufacture a confident answer.

import prisma from "../../config/prisma";
import { resolveEffectiveMinutes, DEFAULT_UTILIZATION_FACTOR } from "./labor.formulas";
import type { KitchenQueueResult, KitchenQueueStation } from "./labor.types";

/** Item statuses that still represent outstanding kitchen work. */
const OUTSTANDING_ITEM_STATUSES = ["PENDING", "CANCEL_REQUESTED"];

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Start of today in server-local time — matches how attendance.service.ts
 * scopes a day, so "clocked in today" means the same thing in both places.
 */
const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getKitchenQueueService = async (
  restaurantId: number,
  branchId: number,
): Promise<KitchenQueueResult> => {
  const [branch, stations, openOrders, standards, presentStaff] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { staffUtilizationFactor: true, targetTicketMinutes: true },
    }),

    prisma.kitchenStation.findMany({
      where: { restaurantId, branchId, isActive: true },
      include: {
        equipment: { where: { isActive: true }, select: { itemsPerHour: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),

    // Same open-order definition getAllRunningOrdersService uses, so the
    // queue this reports can never disagree with what the KDS is showing.
    prisma.runningOrder.findMany({
      where: {
        restaurantId,
        branchId,
        OR: [
          { status: "ACTIVE" },
          { status: "BILLED", kitchenStatus: { in: ["PENDING", "PREPARING"] } },
        ],
      },
      select: {
        id: true,
        batches: {
          select: {
            items: {
              // Only work still outstanding. A DONE item's minutes are already
              // spent and must not be charged to the queue a new dish waits
              // behind — that's exactly what doneAt/status exist to tell us.
              where: { status: { in: OUTSTANDING_ITEM_STATUSES } },
              select: { menuItemId: true, quantity: true },
            },
          },
        },
      },
    }),

    prisma.menuItemStationTime.findMany({
      where: { station: { restaurantId, branchId, isActive: true } },
      select: {
        menuItemId: true,
        stationId: true,
        standardMinutes: true,
        observedMinutes: true,
        observationCount: true,
        // The item's own whole-dish time, carried through so the client can
        // floor its estimate at it. Station splits are frequently incomplete —
        // a dish routed to 3 of 10 stations sums to well under its real cook
        // time — and quoting the sum alone under-promises. See the
        // wholeItemMinutes note on the response type.
        menuItem: { select: { prepTime: true } },
      },
    }),

    // Who is physically on shift. StaffStationSkill says who CAN work a
    // station, attendance says who is here — a station's parallelism is the
    // intersection. See the staffDataAvailable note below for the case where
    // this branch doesn't use the clock at all.
    prisma.attendance.findMany({
      where: {
        restaurantId,
        branchId,
        date: { gte: startOfToday() },
        loginTime: { not: null },
        logoutTime: null,
      },
      select: { userId: true },
    }),
  ]);

  const branchUtilization = branch?.staffUtilizationFactor ?? DEFAULT_UTILIZATION_FACTOR;
  const targetTicketMinutes = branch?.targetTicketMinutes ?? 30;

  if (!stations.length) {
    return {
      configured: false,
      reason: "No kitchen stations are set up for this branch yet.",
      targetTicketMinutes,
      openOrders: openOrders.length,
      staffDataAvailable: presentStaff.length > 0,
      stations: [],
      standards: {},
      wholeItemMinutes: {},
    };
  }
  if (!standards.length) {
    return {
      configured: false,
      reason:
        "Kitchen stations exist, but no per-item labor standards have been set — add them (or seed from prep time) before quoting a wait.",
      targetTicketMinutes,
      openOrders: openOrders.length,
      staffDataAvailable: presentStaff.length > 0,
      stations: [],
      standards: {},
      wholeItemMinutes: {},
    };
  }

  // ── item → stations lookup, with calibration applied ───────────────────────
  // resolveEffectiveMinutes rather than raw standardMinutes so a calibrated
  // item quotes its measured time, exactly as the planning engine would.
  const standardsByItem: Record<number, { stationId: number; minutes: number }[]> = {};
  const wholeItemMinutes: Record<number, number> = {};
  const minutesFor = new Map<string, number>();
  standards.forEach((s) => {
    const { minutes } = resolveEffectiveMinutes(s);
    if (minutes <= 0) return;
    (standardsByItem[s.menuItemId] ??= []).push({ stationId: s.stationId, minutes: round1(minutes) });
    minutesFor.set(`${s.menuItemId}:${s.stationId}`, minutes);
    const prep = s.menuItem?.prepTime;
    if (prep && prep > 0) wholeItemMinutes[s.menuItemId] = prep;
  });

  // ── skilled-and-present headcount per station ─────────────────────────────
  const presentIds = presentStaff.map((a) => a.userId);
  const skills = presentIds.length
    ? await prisma.staffStationSkill.findMany({
        where: { userId: { in: presentIds }, station: { branchId } },
        select: { stationId: true, userId: true },
      })
    : [];
  const presentByStation = new Map<number, number>();
  skills.forEach((s) => presentByStation.set(s.stationId, (presentByStation.get(s.stationId) ?? 0) + 1));

  // ── outstanding work per station ──────────────────────────────────────────
  const queueMinutes = new Map<number, number>();
  const queueItems = new Map<number, number>();
  let unpricedItems = 0;

  openOrders.forEach((order) => {
    order.batches.forEach((batch) => {
      batch.items.forEach((item) => {
        if (item.menuItemId == null) return;
        const itemStations = standardsByItem[item.menuItemId];
        if (!itemStations?.length) {
          // An item with no standard anywhere contributes real work we cannot
          // see. Counted and reported rather than silently ignored, so the UI
          // can say the estimate is incomplete instead of implying the kitchen
          // is emptier than it is.
          unpricedItems += item.quantity || 1;
          return;
        }
        const qty = item.quantity || 1;
        itemStations.forEach(({ stationId }) => {
          const mins = minutesFor.get(`${item.menuItemId}:${stationId}`) ?? 0;
          queueMinutes.set(stationId, (queueMinutes.get(stationId) ?? 0) + qty * mins);
          queueItems.set(stationId, (queueItems.get(stationId) ?? 0) + qty);
        });
      });
    });
  });

  // ── per-station wait ─────────────────────────────────────────────────────
  const staffDataAvailable = presentStaff.length > 0;

  const result: KitchenQueueStation[] = stations.map((s) => {
    const ratedEquipment = s.equipment.filter((e) => e.itemsPerHour && e.itemsPerHour > 0);
    const equipmentItemsPerHour = ratedEquipment.length
      ? ratedEquipment.reduce((sum, e) => sum + (e.itemsPerHour || 0), 0)
      : null;
    // Station's own declared ceiling wins over the equipment rollup — same
    // precedence assessEquipmentCapacity uses.
    const capacityPerHour =
      s.capacityPerHour && s.capacityPerHour > 0
        ? s.capacityPerHour
        : equipmentItemsPerHour && equipmentItemsPerHour > 0
          ? equipmentItemsPerHour
          : null;

    const backlogMinutes = round1(queueMinutes.get(s.id) ?? 0);
    const backlogItems = queueItems.get(s.id) ?? 0;

    // Parallelism. When this branch doesn't clock anyone in, assuming a full
    // crew would understate every wait, so it falls back to a single lane and
    // flags staffDataAvailable=false for the UI to caveat — the conservative
    // direction, since over-promising is the failure that hurts a customer.
    const skilledPresent = presentByStation.get(s.id) ?? 0;
    const lanes = Math.max(1, skilledPresent);

    // Two independent floors on how fast the backlog can clear:
    //   labor — total minutes split across the people who can actually work here,
    //           scaled by the productive fraction of a clock hour;
    //   equipment — items ÷ throughput ceiling, which no amount of staff moves.
    // The real wait is whichever binds harder.
    const utilization = s.utilizationFactor ?? branchUtilization ?? DEFAULT_UTILIZATION_FACTOR;
    const laborWait = round1(backlogMinutes / lanes / Math.min(1, Math.max(0.1, utilization)));
    const equipmentWait = capacityPerHour ? round1((backlogItems / capacityPerHour) * 60) : 0;

    return {
      stationId: s.id,
      code: s.code,
      name: s.name,
      queueMinutes: backlogMinutes,
      queueItems: backlogItems,
      skilledStaffPresent: skilledPresent,
      lanes,
      capacityPerHour,
      laborWaitMinutes: laborWait,
      equipmentWaitMinutes: equipmentWait,
      waitMinutes: round1(Math.max(laborWait, equipmentWait)),
      isEquipmentBound: capacityPerHour != null && equipmentWait > laborWait,
      // Hands-on minutes ÷ this = elapsed minutes at the station. Returned so
      // the POS can price a NEW dish onto the queue the same way the backlog
      // above was priced — without it the client would have to re-derive
      // lanes × utilization and the two figures would drift apart the moment
      // either rule changed here.
      productiveDivisor: round2(lanes * Math.min(1, Math.max(0.1, utilization))),
    };
  });

  return {
    configured: true,
    targetTicketMinutes,
    openOrders: openOrders.length,
    staffDataAvailable,
    unpricedQueueItems: unpricedItems,
    stations: result,
    standards: standardsByItem,
    wholeItemMinutes,
  };
};
