// Labor & Kitchen Capacity Engine — pure, DB-free calculation functions. Same
// convention as finance.formulas.ts and peakHour.formulas.ts: every number the
// labor services quote must come from calling one of these, never re-derived
// inline, so the staffing/capacity math is defined in exactly one place.
//
// WHY THIS EXISTS ALONGSIDE peakHour.formulas.ts
// peakHour.formulas.ts's computeStaffRequirement models the whole kitchen as
// `ceil(orders / 8)` — one global orders-per-staff-hour constant. That is fine
// for a single headline number on the Kitchen page and is left in place
// untouched, but it structurally cannot answer "am I short of people or short
// of equipment?", because it has no concept of WHERE in the kitchen the work
// lands. It also treats 40 biryanis and 40 pizzas as identical load.
//
// This file replaces that with a station-level model:
//   workload minutes(station)  = Σ qty(item) × minutes(item, station)
//   productive minutes(staff)  = window minutes × utilization factor
//   required FTE(station)      = workload minutes ÷ productive minutes
//   equipment-bound(station)   = demand items/hr > station items/hr ceiling
//
// NOT machine learning. Every function here is deterministic arithmetic over
// owner-entered standards and observed history — the same rules-based stance
// ai.rules.ts ("deterministic, no LLM") and peakHour.formulas.ts ("NOT a
// machine-learned model") already take. computeItemCalibrationFactors is a
// documented residual-attribution heuristic, not a fitted model.

// ─── Shared shapes ────────────────────────────────────────────────────────────

/** One menu item's demand over the window being analysed. */
export interface ItemDemand {
  menuItemId: number;
  itemName: string;
  /** Units of this item expected/observed in the window. May be fractional (an average across days). */
  quantity: number;
}

/** A per-item, per-station labor standard, as stored in MenuItemStationTime. */
export interface StationTimeStandard {
  menuItemId: number;
  stationId: number;
  standardMinutes: number;
  observedMinutes: number | null;
  observationCount: number;
}

export interface StationConfig {
  stationId: number;
  code: string;
  name: string;
  /** Null = inherit the branch default. */
  utilizationFactor: number | null;
  /** Station's own items/hour ceiling, or null to fall back to summed equipment throughput. */
  capacityPerHour: number | null;
  /** Σ itemsPerHour of the station's active equipment. Null/0 when no equipment declares a rate. */
  equipmentItemsPerHour: number | null;
}

/** One staff member available for the window, with their station skills. */
export interface CrewMember {
  userId: number;
  name: string;
  /** Fraction of the analysed window this person is available for. Normally 1. */
  availableFte: number;
  skills: { stationId: number; proficiency: number; speedFactor: number }[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Fallback productive-time fraction when neither the station nor the branch has
 * one set. 0.75 (45 productive minutes per clock hour) is the conventional
 * kitchen planning figure: the remaining quarter-hour goes to walking,
 * cleaning, fetching ingredients, coordination, equipment waits and task
 * switching. Exported so it is a single source of truth rather than a magic
 * number, exactly like peakHour.formulas.ts's DEFAULT_ORDERS_PER_STAFF_HOUR.
 */
export const DEFAULT_UTILIZATION_FACTOR = 0.75;

/**
 * How many calibrating observations a (item, station) pair needs before its
 * observedMinutes is trusted over the owner's entered standardMinutes. Below
 * this, a couple of unusually slow tickets could rewrite a standard.
 */
export const MIN_OBSERVATIONS_TO_TRUST = 20;

/** A station is called equipment-bound at or above this share of its throughput ceiling — same 90% threshold peakHour.formulas.ts's computeBottleneckStatus already uses for kitchen-wide load, kept identical so the two features never disagree about what "at capacity" means. */
export const EQUIPMENT_BOUND_THRESHOLD_PERCENT = 90;

/** Shortfall below this many FTE is rounding noise, not a staffing gap worth telling a manager about. */
export const MATERIAL_FTE_SHORTFALL = 0.25;

/** Spare capacity above this many FTE at a station counts as genuinely overstaffed (i.e. a whole person could move elsewhere). */
export const MATERIAL_FTE_SURPLUS = 1.0;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── 1. Effective labor standard per item/station ─────────────────────────────

/**
 * The minutes-per-unit figure to actually plan with for one (item, station)
 * pair: the calibrated observedMinutes once enough orders have been observed,
 * otherwise the owner's entered standardMinutes.
 *
 * Deliberately prefers the owner's standard until MIN_OBSERVATIONS_TO_TRUST is
 * reached rather than blending the two — a half-calibrated number is harder to
 * explain to a manager than "your standard" or "measured from N orders", and
 * the UI shows both columns side by side either way.
 */
export const resolveEffectiveMinutes = (
  standard: Pick<StationTimeStandard, "standardMinutes" | "observedMinutes" | "observationCount">,
  minObservations: number = MIN_OBSERVATIONS_TO_TRUST,
): { minutes: number; source: "observed" | "standard" } => {
  const trusted =
    standard.observedMinutes != null &&
    standard.observedMinutes > 0 &&
    standard.observationCount >= minObservations;
  return trusted
    ? { minutes: standard.observedMinutes as number, source: "observed" }
    : { minutes: Math.max(0, standard.standardMinutes || 0), source: "standard" };
};

// ─── 2. Demand → station workload ─────────────────────────────────────────────

export interface StationWorkload {
  stationId: number;
  /** Total hands-on labor minutes this station must absorb over the window. */
  workloadMinutes: number;
  /** Units of food passing through this station over the window — the figure equipment throughput is compared against. */
  itemUnits: number;
  /** Per-item contribution, largest first — this is what makes a workload number auditable ("280 grill minutes = 40 burgers × 4 + 20 pizzas × 6"). */
  contributors: { menuItemId: number; itemName: string; quantity: number; minutes: number }[];
}

/**
 * Turn item-level demand into per-station labor minutes — step 2 of the
 * engine, and the whole reason the station tables exist. An item contributes
 * to a station only if it has a positive standard there, so a fryer never gets
 * charged for a biryani.
 */
export const computeStationWorkloads = (
  demand: ItemDemand[],
  standards: StationTimeStandard[],
  minObservations: number = MIN_OBSERVATIONS_TO_TRUST,
): StationWorkload[] => {
  // Index standards by item so each demand row is a single lookup rather than
  // a scan — a full menu × full station list is easily thousands of pairs.
  const byItem = new Map<number, StationTimeStandard[]>();
  standards.forEach((s) => {
    const list = byItem.get(s.menuItemId);
    if (list) list.push(s);
    else byItem.set(s.menuItemId, [s]);
  });

  const acc = new Map<number, StationWorkload>();

  demand.forEach((d) => {
    if (!d.quantity || d.quantity <= 0) return;
    const itemStandards = byItem.get(d.menuItemId);
    if (!itemStandards) return; // no labor standard entered for this item yet

    itemStandards.forEach((s) => {
      const { minutes } = resolveEffectiveMinutes(s, minObservations);
      if (minutes <= 0) return;

      const entry =
        acc.get(s.stationId) ??
        { stationId: s.stationId, workloadMinutes: 0, itemUnits: 0, contributors: [] };

      const contributed = d.quantity * minutes;
      entry.workloadMinutes += contributed;
      entry.itemUnits += d.quantity;
      entry.contributors.push({
        menuItemId: d.menuItemId,
        itemName: d.itemName,
        quantity: round2(d.quantity),
        minutes: round1(contributed),
      });
      acc.set(s.stationId, entry);
    });
  });

  return [...acc.values()].map((e) => ({
    ...e,
    workloadMinutes: round1(e.workloadMinutes),
    itemUnits: round2(e.itemUnits),
    contributors: e.contributors.sort((a, b) => b.minutes - a.minutes),
  }));
};

// ─── 3. Workload → required staff ─────────────────────────────────────────────

/**
 * Productive minutes ONE staff member actually contributes over a window of
 * `windowMinutes` — the "a person isn't productive for 60 minutes out of every
 * 60" correction. Without this, every staffing number in the system is
 * optimistic by roughly a quarter.
 */
export const computeProductiveMinutesPerStaff = (
  windowMinutes: number,
  utilizationFactor: number | null | undefined,
): number => {
  if (!windowMinutes || windowMinutes <= 0) return 0;
  // Clamped rather than trusted: a stored 0 would divide-by-zero into an
  // infinite staff requirement, and a stored 1.4 would claim 84 productive
  // minutes per hour.
  const factor = clamp(Number(utilizationFactor) || DEFAULT_UTILIZATION_FACTOR, 0.1, 1);
  return round1(windowMinutes * factor);
};

/**
 * Required staff (as fractional FTE — NOT rounded up here) to absorb
 * `workloadMinutes` in a window where one person contributes
 * `productiveMinutesPerStaff`.
 *
 * Returned fractional on purpose. Rounding each station up in isolation is
 * what produces the "5 + 3 + 2 + 2 = 12 people" overestimate; the fractions
 * have to survive until allocateCrewToStations has had a chance to cover a
 * 0.4-FTE plating gap with a griller's spare time.
 */
export const computeRequiredFte = (
  workloadMinutes: number,
  productiveMinutesPerStaff: number,
): number => {
  if (!workloadMinutes || workloadMinutes <= 0) return 0;
  if (!productiveMinutesPerStaff || productiveMinutesPerStaff <= 0) return 0;
  return round2(workloadMinutes / productiveMinutesPerStaff);
};

/**
 * Bodies needed to cover a set of per-station FTE requirements: the ceiling of
 * the SUM, never the sum of the ceilings.
 *
 * This one line is the difference between the spec's "5 + 3 + 2 + 2 = 12 people"
 * and the truth. Rounding each station up in isolation charges a full extra
 * person for every 0.28-FTE tail, and with ten stations that inflates the
 * headcount by several people — the exact overestimate this engine exists to
 * eliminate. getCapacitySweepService already pooled correctly; the staffing
 * plan's headline KPI did not, so the two disagreed.
 *
 * Assumes the crew is cross-trained enough to pool their time. Where it isn't,
 * allocateCrewToStations's per-station shortfall and unskilledShortfallFte
 * report that separately rather than hiding it in this number.
 */
export const computePooledHeadcount = (requiredFteByStation: number[]): number => {
  const total = requiredFteByStation.reduce((s, v) => s + Math.max(0, v || 0), 0);
  if (total <= 0.001) return 0;
  // The epsilon absorbs float drift so 3.0000000004 doesn't demand a 4th person.
  return Math.ceil(total - 0.001);
};

// ─── 4. Equipment ceiling ─────────────────────────────────────────────────────

export interface EquipmentAssessment {
  /** Effective items/hour ceiling used, or null when nothing declares one. */
  capacityPerHour: number | null;
  utilizationPercent: number | null;
  /** True only when a ceiling is known AND demand is at/over EQUIPMENT_BOUND_THRESHOLD_PERCENT of it. */
  isEquipmentBound: boolean;
  /** Items/hour of demand the station physically cannot produce. 0 when within capacity or unknown. */
  unservableItemsPerHour: number;
  /** Fraction of demand the station can actually produce (1 = all of it). Used to cap the staffing recommendation. */
  servableFraction: number;
}

/**
 * Whether a station's own throughput — not its staffing — is the binding
 * constraint. This is the check that stops the engine recommending a hire that
 * cannot possibly help: if the oven tops out at 70 pizzas/hour, the 100th
 * pizza is not waiting for a person.
 *
 * Falls back to summed equipment throughput when the station has no explicit
 * ceiling, and returns "no assessment" (null capacity, isEquipmentBound false)
 * when neither is known — never a guessed threshold, matching
 * computeBottleneckStatus's stance in peakHour.formulas.ts.
 */
export const assessEquipmentCapacity = (
  demandItemsPerHour: number,
  station: Pick<StationConfig, "capacityPerHour" | "equipmentItemsPerHour">,
): EquipmentAssessment => {
  const ceiling =
    station.capacityPerHour && station.capacityPerHour > 0
      ? station.capacityPerHour
      : station.equipmentItemsPerHour && station.equipmentItemsPerHour > 0
        ? station.equipmentItemsPerHour
        : null;

  if (!ceiling) {
    return {
      capacityPerHour: null,
      utilizationPercent: null,
      isEquipmentBound: false,
      unservableItemsPerHour: 0,
      servableFraction: 1,
    };
  }

  const demand = Math.max(0, demandItemsPerHour);
  const utilizationPercent = Math.round((demand / ceiling) * 100);
  return {
    capacityPerHour: ceiling,
    utilizationPercent,
    isEquipmentBound: utilizationPercent >= EQUIPMENT_BOUND_THRESHOLD_PERCENT,
    unservableItemsPerHour: Math.max(0, round1(demand - ceiling)),
    servableFraction: demand > ceiling ? round2(ceiling / demand) : 1,
  };
};

// ─── 5. Rolling windows (arrival peaks inside an hour) ────────────────────────

export interface RollingWindowPeak {
  windowMinutes: number;
  /** Index of the first bucket in the peak window. */
  startBucket: number;
  /** Minutes from the start of the series to the peak window's start — caller maps this to a clock time. */
  startOffsetMinutes: number;
  /** Summed value (orders, or workload minutes) over the peak window. */
  peakValue: number;
  /** The same load expressed per hour, so a 15-minute peak and a 90-minute peak are comparable. */
  peakValuePerHour: number;
}

/**
 * Peak load over a sliding window, for the "an hourly average hides the
 * 7:45–8:00 rush" problem. Averaging 60 orders across an hour says 4 cooks;
 * if 40 of those 60 land in the final quarter-hour, the queue explodes anyway.
 *
 * `buckets` is a fixed-resolution series (15-minute buckets throughout this
 * module) and the window is expressed in minutes; a window shorter than one
 * bucket is treated as one bucket.
 */
export const computeRollingWindowPeak = (
  buckets: number[],
  bucketMinutes: number,
  windowMinutes: number,
): RollingWindowPeak | null => {
  if (!buckets.length || bucketMinutes <= 0) return null;
  const span = Math.max(1, Math.round(windowMinutes / bucketMinutes));
  if (span > buckets.length) return null;

  // Prefix sums so every candidate window is O(1) — the series is a whole
  // trading day at 15-minute resolution and this runs once per station per
  // window size.
  const prefix = [0];
  buckets.forEach((v, i) => prefix.push(prefix[i] + (Number(v) || 0)));

  let bestStart = 0;
  let bestValue = -Infinity;
  for (let start = 0; start + span <= buckets.length; start++) {
    const total = prefix[start + span] - prefix[start];
    if (total > bestValue) {
      bestValue = total;
      bestStart = start;
    }
  }

  const actualWindowMinutes = span * bucketMinutes;
  return {
    windowMinutes: actualWindowMinutes,
    startBucket: bestStart,
    startOffsetMinutes: bestStart * bucketMinutes,
    peakValue: round1(bestValue),
    peakValuePerHour: round1((bestValue * 60) / actualWindowMinutes),
  };
};

// ─── 6. Crew allocation across stations ───────────────────────────────────────

export interface StationRequirement {
  stationId: number;
  /** FTE the workload calls for, already capped to what the equipment can actually produce. */
  requiredFte: number;
}

export interface CrewAssignment {
  userId: number;
  name: string;
  /** Stations this person covers and the fraction of the window spent at each. Multiple entries = a split role ("Grill + Plating"). */
  stations: { stationId: number; fractionOfWindow: number }[];
  /** Fraction of the window left unassigned. */
  idleFraction: number;
}

export interface AllocationResult {
  assignments: CrewAssignment[];
  perStation: {
    stationId: number;
    requiredFte: number;
    coveredFte: number;
    shortfallFte: number;
    surplusFte: number;
    /** People contributing any time to this station. */
    headcount: number;
  }[];
  totalShortfallFte: number;
  totalSurplusFte: number;
  /** Requirement that no available person is skilled for at all — a training/hiring signal distinct from plain understaffing. */
  unskilledShortfallFte: number;
}

/** Granularity of a single allocation step, in FTE. 0.1 of a 60-minute window is 6 minutes — about the smallest slice a manager can actually redeploy someone for. */
const ALLOCATION_STEP_FTE = 0.1;

/**
 * Assign the available crew across stations, allowing one person to cover more
 * than one station — the "you don't necessarily need 5 + 3 + 2 + 2 = 12
 * people" step. Without this, per-station requirements get rounded up
 * independently and the recommendation overstates headcount by several people.
 *
 * MAX-MIN FAIR (water-filling), not "neediest station first". This distinction
 * is the difference between a usable plan and a nonsensical one. An earlier
 * version repeatedly picked the station with the largest ABSOLUTE remaining
 * requirement and gave it as much as one person could supply. With 5 cooks
 * against 10 stations that produced four cooks stacked on Prep (the single
 * biggest number) and the wok, tandoor and fryer completely unmanned — feasible
 * arithmetic, but something no kitchen would ever do, and it made a real
 * shortfall look like a bizarre rostering choice.
 *
 * So stations are filled by lowest COVERAGE RATIO (covered ÷ required) in small
 * steps instead. When the crew cannot cover everything, every station ends up
 * proportionally staffed rather than a few fully staffed and the rest abandoned
 * — which is what a head chef actually does when short-handed. When the crew CAN
 * cover everything, the outcome is the same full coverage either way.
 *
 * Still a heuristic, not a proven optimum: a true cost-minimising assignment is
 * a linear program, deliberately out of scope. The shortfall/surplus figures are
 * honest regardless — this can only under-use the crew, never invent capacity.
 *
 * Person choice, in order:
 *   1. already working this station — keeps time contiguous;
 *   2. fewest distinct stations so far — the anti-smearing rule. Without it the
 *      highest-proficiency cook wins the FIRST step at every station (nobody is
 *      "already here" yet) and ends up holding ten stations at 10% each, i.e.
 *      six minutes apiece, which is not a shift anyone can work;
 *   3. proficiency desc, 4. speedFactor desc, 5. spare capacity desc,
 *   6. userId asc — the trailing userId keeps output stable across identical
 *      crews rather than dependent on map iteration order.
 *
 * proficiency and speedFactor are used for DIFFERENT jobs and never
 * multiplied together: proficiency decides eligibility and who gets picked
 * first, speedFactor scales how much requirement their time actually covers.
 * Folding both into throughput would double-count the same judgement.
 */
export const allocateCrewToStations = (
  requirements: StationRequirement[],
  crew: CrewMember[],
): AllocationResult => {
  const required = new Map<number, number>();
  const remaining = new Map<number, number>();
  requirements.forEach((r) => {
    const need = Math.max(0, r.requiredFte);
    required.set(r.stationId, need);
    remaining.set(r.stationId, need);
  });

  const spare = new Map<number, number>();
  crew.forEach((c) => spare.set(c.userId, clamp(Number(c.availableFte) || 0, 0, 1)));

  // userId → stationId → fraction assigned
  const assigned = new Map<number, Map<number, number>>();
  crew.forEach((c) => assigned.set(c.userId, new Map()));

  const skillOf = (member: CrewMember, stationId: number) =>
    member.skills.find((s) => s.stationId === stationId);

  // Bounded by how much crew time exists to hand out, plus slack: every
  // iteration either hands out a step, exhausts a person, or closes a station.
  const totalCapacity = [...spare.values()].reduce((s, v) => s + v, 0);
  const maxIterations = Math.ceil(totalCapacity / ALLOCATION_STEP_FTE) + requirements.length * 2 + 10;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Least-well-covered station that somebody available can actually work.
    let targetStation: number | null = null;
    let bestRatio = Infinity;
    let bestRemaining = 0;

    remaining.forEach((need, stationId) => {
      if (need <= 0.001) return;
      const hasCandidate = crew.some(
        (c) => (spare.get(c.userId) ?? 0) > 0.001 && skillOf(c, stationId),
      );
      if (!hasCandidate) return; // nobody can work here — leave it short

      const total = required.get(stationId) ?? 0;
      const ratio = total > 0 ? (total - need) / total : 1;
      // Tie-break on larger absolute remaining, then stationId, so two equally
      // covered stations resolve deterministically.
      if (
        ratio < bestRatio - 1e-9 ||
        (Math.abs(ratio - bestRatio) <= 1e-9 &&
          (need > bestRemaining + 1e-9 ||
            (Math.abs(need - bestRemaining) <= 1e-9 && targetStation !== null && stationId < targetStation)))
      ) {
        bestRatio = ratio;
        bestRemaining = need;
        targetStation = stationId;
      }
    });

    if (targetStation === null) break;
    const station = targetStation as number;
    const targetRemaining = remaining.get(station) as number;

    const candidates = crew
      .filter((c) => (spare.get(c.userId) ?? 0) > 0.001 && skillOf(c, station))
      .sort((a, b) => {
        const sa = skillOf(a, station)!;
        const sb = skillOf(b, station)!;
        const aHere = (assigned.get(a.userId)!.get(station) ?? 0) > 0 ? 1 : 0;
        const bHere = (assigned.get(b.userId)!.get(station) ?? 0) > 0 ? 1 : 0;
        // Distinct stations already held — fewer wins, so opening a new station
        // falls to whoever is least fragmented rather than always to the most
        // proficient cook.
        const aSpread = [...assigned.get(a.userId)!.values()].filter((f) => f > 0).length;
        const bSpread = [...assigned.get(b.userId)!.values()].filter((f) => f > 0).length;
        return (
          bHere - aHere ||
          aSpread - bSpread ||
          sb.proficiency - sa.proficiency ||
          sb.speedFactor - sa.speedFactor ||
          (spare.get(b.userId) ?? 0) - (spare.get(a.userId) ?? 0) ||
          a.userId - b.userId
        );
      });

    const chosen = candidates[0];
    const skill = skillOf(chosen, station)!;
    const speed = clamp(Number(skill.speedFactor) || 1, 0.25, 3);
    const availableFraction = spare.get(chosen.userId) ?? 0;

    // Time needed FROM THIS PERSON for one step of coverage: a 25%-faster cook
    // delivers 0.1 FTE of coverage using 0.08 of their window. Capped at what
    // the station still needs, so the last slice never over-serves it.
    const fractionForStep = ALLOCATION_STEP_FTE / speed;
    const fractionToClose = targetRemaining / speed;
    const fractionGiven = Math.min(availableFraction, fractionForStep, fractionToClose);
    if (fractionGiven <= 1e-9) break;

    const perStation = assigned.get(chosen.userId)!;
    perStation.set(station, round2((perStation.get(station) ?? 0) + fractionGiven));
    spare.set(chosen.userId, round2(availableFraction - fractionGiven));
    remaining.set(station, round2(targetRemaining - fractionGiven * speed));
  }

  const assignments: CrewAssignment[] = crew.map((c) => {
    const perStation = assigned.get(c.userId)!;
    return {
      userId: c.userId,
      name: c.name,
      stations: [...perStation.entries()]
        .filter(([, f]) => f > 0.001)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([stationId, fractionOfWindow]) => ({ stationId, fractionOfWindow })),
      idleFraction: Math.max(0, round2(spare.get(c.userId) ?? 0)),
    };
  });

  let unskilledShortfallFte = 0;
  const perStation = requirements.map((r) => {
    const stillNeeded = Math.max(0, remaining.get(r.stationId) ?? 0);
    const coveredFte = round2(Math.max(0, r.requiredFte - stillNeeded));
    const headcount = assignments.filter((a) =>
      a.stations.some((s) => s.stationId === r.stationId),
    ).length;

    // Nobody rostered has this station in their skill matrix at all.
    const anyoneSkilled = crew.some((c) => c.skills.some((s) => s.stationId === r.stationId));
    if (!anyoneSkilled) unskilledShortfallFte += stillNeeded;

    return {
      stationId: r.stationId,
      requiredFte: round2(r.requiredFte),
      coveredFte,
      shortfallFte: round2(stillNeeded),
      // Surplus is only meaningful once the requirement is met; idle crew time
      // is reported per person via idleFraction rather than smeared across
      // stations that didn't ask for it.
      surplusFte: 0,
      headcount,
    };
  });

  const totalSurplusFte = round2(
    assignments.reduce((s, a) => s + a.idleFraction, 0),
  );

  return {
    assignments,
    perStation,
    totalShortfallFte: round2(perStation.reduce((s, p) => s + p.shortfallFte, 0)),
    totalSurplusFte,
    unskilledShortfallFte: round2(unskilledShortfallFte),
  };
};

// ─── 7. Constraint classification ─────────────────────────────────────────────

export type StationConstraint =
  | "EQUIPMENT_BOUND"
  | "LABOR_SHORT"
  | "UNSKILLED"
  | "BALANCED"
  | "IDLE";

/**
 * What is actually limiting one station. The ORDER of these checks is the
 * point of the whole feature: equipment is tested FIRST, because when the oven
 * is the ceiling, a staffing shortfall at that station is a symptom and hiring
 * against it wastes money.
 */
export const classifyStationConstraint = (
  input: {
    requiredFte: number;
    shortfallFte: number;
    isEquipmentBound: boolean;
    anyoneSkilled: boolean;
  },
): StationConstraint => {
  if (input.isEquipmentBound) return "EQUIPMENT_BOUND";
  if (input.requiredFte <= 0.001) return "IDLE";
  if (input.shortfallFte > MATERIAL_FTE_SHORTFALL) {
    return input.anyoneSkilled ? "LABOR_SHORT" : "UNSKILLED";
  }
  return "BALANCED";
};

export type CapacityVerdict =
  | "NOT_CONFIGURED"
  | "INVEST_IN_EQUIPMENT"
  | "HIRE_STAFF"
  | "REALLOCATE_STAFF"
  | "TRAIN_STAFF"
  | "ADD_SEATING"
  | "BALANCED";

export interface VerdictInput {
  stations: { stationId: number; code: string; name: string; constraint: StationConstraint; shortfallFte: number; unservableItemsPerHour: number }[];
  /** Idle crew time available to move, in FTE. */
  totalSurplusFte: number;
  /** Seat utilization % from the existing table-operations analytics, or null when tables have no capacity set. */
  seatUtilizationPercent: number | null;
  /**
   * Whether ANY station actually has workload to reason about — i.e. stations
   * exist AND menu items have labor standards feeding them.
   *
   * Without this flag an unconfigured branch produces an empty `stations` array,
   * every "is anything short?" check trivially passes, and the function returns
   * a confident BALANCED — "no action needed" derived from no model at all.
   * That is the single most misleading output this engine could emit, so the
   * absence of a model is reported as its own verdict rather than as good news.
   */
  hasModelledWorkload: boolean;
}

/**
 * The single branch-level answer: buy equipment, hire, move people around,
 * train, add seating, or nothing. Precedence is deliberate and is the whole
 * "people + equipment + stations + recipes + demand" judgement compressed into
 * one recommendation:
 *
 *  1. EQUIPMENT_BOUND anywhere wins — no amount of hiring raises a hard
 *     throughput ceiling, so recommending a hire first would burn payroll on a
 *     problem it cannot touch.
 *  2. A labor shortfall that idle crew time could absorb is REALLOCATE_STAFF,
 *     not HIRE_STAFF. Free to act on, so it must be checked before hiring.
 *  3. A shortfall at a station nobody rostered is skilled for is TRAIN_STAFF —
 *     the bodies are present, the capability isn't.
 *  4. Only then HIRE_STAFF.
 *  5. Kitchen comfortable but the dining room saturated (>= 85% seat
 *     utilization) is ADD_SEATING — the constraint has moved out of the
 *     kitchen entirely.
 *
 * Before any of that: an unmodelled kitchen returns NOT_CONFIGURED. "I cannot
 * tell you yet" and "you are fine" are completely different answers, and only
 * one of them is true when no labor standards exist.
 */
export const summarizeCapacityVerdict = (input: VerdictInput): {
  verdict: CapacityVerdict;
  headline: string;
  bindingStationCode: string | null;
} => {
  if (!input.hasModelledWorkload) {
    return {
      verdict: "NOT_CONFIGURED",
      headline:
        "There is order history to work from, but no station workload to analyse yet — add kitchen stations and per-station labor standards before trusting any staffing number on this page.",
      bindingStationCode: null,
    };
  }

  const equipmentBound = input.stations.filter((s) => s.constraint === "EQUIPMENT_BOUND");
  if (equipmentBound.length) {
    const worst = [...equipmentBound].sort((a, b) => b.unservableItemsPerHour - a.unservableItemsPerHour)[0];
    return {
      verdict: "INVEST_IN_EQUIPMENT",
      headline:
        worst.unservableItemsPerHour > 0
          ? `${worst.name} cannot physically produce ${worst.unservableItemsPerHour} items/hr of the forecast demand — extra staff there will not help.`
          : `${worst.name} is running at its throughput ceiling — extra staff there will not raise output.`,
      bindingStationCode: worst.code,
    };
  }

  const short = input.stations.filter((s) => s.constraint === "LABOR_SHORT");
  const unskilled = input.stations.filter((s) => s.constraint === "UNSKILLED");
  const totalShort = round2([...short, ...unskilled].reduce((s, x) => s + x.shortfallFte, 0));

  if (short.length && input.totalSurplusFte >= totalShort && totalShort > 0) {
    const worst = [...short].sort((a, b) => b.shortfallFte - a.shortfallFte)[0];
    return {
      verdict: "REALLOCATE_STAFF",
      headline: `${worst.name} is short ${worst.shortfallFte} staff-equivalents, but there is ${input.totalSurplusFte} FTE of idle time on the roster — move people rather than hiring.`,
      bindingStationCode: worst.code,
    };
  }

  if (unskilled.length && !short.length) {
    const worst = [...unskilled].sort((a, b) => b.shortfallFte - a.shortfallFte)[0];
    return {
      verdict: "TRAIN_STAFF",
      headline: `${worst.name} needs ${worst.shortfallFte} staff-equivalents and nobody currently rostered is marked able to work it.`,
      bindingStationCode: worst.code,
    };
  }

  if (totalShort > MATERIAL_FTE_SHORTFALL) {
    const worst = [...short, ...unskilled].sort((a, b) => b.shortfallFte - a.shortfallFte)[0];
    return {
      verdict: "HIRE_STAFF",
      headline: `The kitchen is short ${totalShort} staff-equivalents at peak, worst at ${worst.name} — and there is not enough idle roster time to cover it.`,
      bindingStationCode: worst.code,
    };
  }

  if (input.seatUtilizationPercent != null && input.seatUtilizationPercent >= 85) {
    return {
      verdict: "ADD_SEATING",
      headline: `The kitchen keeps up with peak demand, but seating is ${Math.round(input.seatUtilizationPercent)}% utilized — the constraint is dining-room capacity, not the kitchen.`,
      bindingStationCode: null,
    };
  }

  return {
    verdict: "BALANCED",
    headline: "Kitchen capacity and staffing both keep up with forecast peak demand.",
    bindingStationCode: null,
  };
};

// ─── 8. Labor cost of a plan ──────────────────────────────────────────────────

/**
 * Cost of staffing a window, so a plan can be judged on "minimum labor cost at
 * an acceptable ticket time" rather than raw headcount. Hourly rate is derived
 * the same way finance.formulas.ts's computeOvertimeCost does — monthly salary
 * ÷ (30 × standard shift hours) — so the two never disagree about what an hour
 * of a given person costs.
 */
export const computeWindowLaborCost = (
  crew: { monthlySalary: number; standardShiftHours: number; fractionOfWindow: number }[],
  windowMinutes: number,
): number => {
  if (windowMinutes <= 0) return 0;
  const windowHours = windowMinutes / 60;
  return Math.round(
    crew.reduce((sum, c) => {
      const hourlyRate = c.standardShiftHours > 0 ? c.monthlySalary / (30 * c.standardShiftHours) : 0;
      return sum + hourlyRate * windowHours * clamp(c.fractionOfWindow, 0, 1);
    }, 0),
  );
};

// ─── 9. Calibration from actual order history ─────────────────────────────────

export interface CalibrationObservation {
  /** Actual wall-clock kitchen minutes for one completed order. */
  actualMinutes: number;
  /** How many other orders were open in the kitchen at the same time. */
  concurrency: number;
  items: { menuItemId: number; predictedMinutes: number }[];
}

/**
 * Highest concurrency an order may have been cooked at and still be used for
 * calibration. RunningOrder gives wall-clock duration (startedAt → completedAt),
 * which is hands-on time PLUS queue wait; the two are only separable when
 * almost nothing else was in the kitchen. Orders above this threshold are
 * dropped rather than corrected, because the size of their wait is unknowable
 * from this schema.
 */
export const MAX_CONCURRENCY_FOR_CALIBRATION = 2;

/** Per-order ratios outside this band are treated as data errors (a ticket left open for an hour, a comped order closed instantly), not as evidence about labor times. */
const CALIBRATION_RATIO_BOUNDS: [number, number] = [0.25, 4];

export interface CalibrationResult {
  menuItemId: number;
  /** Multiplier to apply to the item's standard minutes. 1.2 = really takes 20% longer than entered. */
  factor: number;
  observationCount: number;
}

/**
 * Calibrate per-item labor standards against what the kitchen actually did.
 *
 * METHOD — share-weighted residual attribution, and its limits, stated plainly:
 * an order's duration is one number covering several items, so no exact
 * per-item time is recoverable from it. For each usable order we take the
 * ratio actual ÷ predicted and credit it to that order's items in proportion
 * to how much of the prediction each item contributed; averaging those ratios
 * per item across many orders converges on a stable correction. An item that
 * only ever appears alongside others gets a weaker, more diluted signal than
 * one that is often ordered alone — which is the honest outcome, not a flaw to
 * paper over.
 *
 * This is a deterministic heuristic, NOT a fitted regression and NOT machine
 * learning. It deliberately does not attempt per-EMPLOYEE calibration: nothing
 * in the schema records which cook prepared which item, so any per-person
 * speed figure derived here would be invented. StaffStationSkill.speedFactor
 * stays owner-entered for exactly that reason.
 */
export const computeItemCalibrationFactors = (
  observations: CalibrationObservation[],
  maxConcurrency: number = MAX_CONCURRENCY_FOR_CALIBRATION,
): CalibrationResult[] => {
  const acc = new Map<number, { weightedRatio: number; weight: number; count: number }>();

  observations.forEach((o) => {
    if (o.concurrency > maxConcurrency) return;
    if (!o.actualMinutes || o.actualMinutes <= 0) return;

    const predictedTotal = o.items.reduce((s, i) => s + Math.max(0, i.predictedMinutes), 0);
    if (predictedTotal <= 0) return;

    const ratio = o.actualMinutes / predictedTotal;
    if (ratio < CALIBRATION_RATIO_BOUNDS[0] || ratio > CALIBRATION_RATIO_BOUNDS[1]) return;

    o.items.forEach((i) => {
      const weight = Math.max(0, i.predictedMinutes);
      if (weight <= 0) return;
      const entry = acc.get(i.menuItemId) ?? { weightedRatio: 0, weight: 0, count: 0 };
      entry.weightedRatio += ratio * weight;
      entry.weight += weight;
      entry.count += 1;
      acc.set(i.menuItemId, entry);
    });
  });

  return [...acc.entries()].map(([menuItemId, e]) => ({
    menuItemId,
    factor: round2(e.weight > 0 ? e.weightedRatio / e.weight : 1),
    observationCount: e.count,
  }));
};

/**
 * How many orders overlapped each order in the kitchen — the input to
 * CalibrationObservation.concurrency. O(n log n) via a sweep over start/end
 * events rather than the naive O(n²) pairwise overlap check, since this runs
 * over every completed order in the calibration window.
 */
export const computeOrderConcurrency = (
  orders: { id: number; startMs: number; endMs: number }[],
): Map<number, number> => {
  const result = new Map<number, number>();
  if (!orders.length) return result;

  const events: { at: number; delta: number; id: number | null }[] = [];
  orders.forEach((o) => {
    events.push({ at: o.startMs, delta: 1, id: o.id });
    events.push({ at: o.endMs, delta: -1, id: null });
  });
  // Ends before starts at the same instant: an order finishing exactly as
  // another begins was not competing for a cook's hands.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);

  let open = 0;
  events.forEach((e) => {
    if (e.delta === 1) {
      // Concurrency AT THE MOMENT THIS ORDER STARTED, excluding itself.
      result.set(e.id as number, open);
      open += 1;
    } else {
      open -= 1;
    }
  });

  return result;
};
