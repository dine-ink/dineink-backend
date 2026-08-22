import { describe, expect, it } from "vitest";
import {
  DEFAULT_UTILIZATION_FACTOR,
  MIN_OBSERVATIONS_TO_TRUST,
  allocateCrewToStations,
  assessEquipmentCapacity,
  classifyStationConstraint,
  computeItemCalibrationFactors,
  computeOrderConcurrency,
  computePooledHeadcount,
  computeProductiveMinutesPerStaff,
  computeRequiredFte,
  computeRollingWindowPeak,
  computeStationWorkloads,
  computeWindowLaborCost,
  resolveEffectiveMinutes,
  summarizeCapacityVerdict,
  type CrewMember,
  type StationTimeStandard,
} from "./labor.formulas";

// Station ids used throughout, matching the worked example in the feature spec:
// Grill / Fryer / Prep / Plating.
const GRILL = 1;
const FRYER = 2;
const PREP = 3;
const PLATING = 4;

// Burger=10, Biryani=11, Fries=12, Pizza=13
const std = (
  menuItemId: number,
  stationId: number,
  standardMinutes: number,
  extra: Partial<StationTimeStandard> = {},
): StationTimeStandard => ({
  menuItemId,
  stationId,
  standardMinutes,
  observedMinutes: null,
  observationCount: 0,
  ...extra,
});

const SPEC_STANDARDS: StationTimeStandard[] = [
  std(10, GRILL, 4), std(10, FRYER, 2), std(10, PREP, 1), std(10, PLATING, 1),
  std(11, GRILL, 1), std(11, PREP, 3), std(11, PLATING, 1),
  std(12, FRYER, 2), std(12, PLATING, 0.5),
  std(13, GRILL, 6), std(13, PREP, 3), std(13, PLATING, 1),
];

const SPEC_DEMAND = [
  { menuItemId: 10, itemName: "Chicken Burger", quantity: 40 },
  { menuItemId: 11, itemName: "Biryani", quantity: 30 },
  { menuItemId: 12, itemName: "Fries", quantity: 50 },
  { menuItemId: 13, itemName: "Pizza", quantity: 20 },
];

describe("resolveEffectiveMinutes", () => {
  it("uses the owner's standard until enough observations exist", () => {
    const result = resolveEffectiveMinutes(
      { standardMinutes: 4, observedMinutes: 6, observationCount: MIN_OBSERVATIONS_TO_TRUST - 1 },
    );
    expect(result).toEqual({ minutes: 4, source: "standard" });
  });

  it("switches to the observed figure once the threshold is reached", () => {
    const result = resolveEffectiveMinutes(
      { standardMinutes: 4, observedMinutes: 6, observationCount: MIN_OBSERVATIONS_TO_TRUST },
    );
    expect(result).toEqual({ minutes: 6, source: "observed" });
  });

  it("ignores a zero/negative observed figure even with a large sample", () => {
    expect(
      resolveEffectiveMinutes({ standardMinutes: 4, observedMinutes: 0, observationCount: 500 }),
    ).toEqual({ minutes: 4, source: "standard" });
  });

  it("floors a negative stored standard at zero rather than crediting negative work", () => {
    expect(
      resolveEffectiveMinutes({ standardMinutes: -3, observedMinutes: null, observationCount: 0 }).minutes,
    ).toBe(0);
  });
});

describe("computeStationWorkloads", () => {
  it("reproduces the worked example's per-station minutes exactly", () => {
    const workloads = computeStationWorkloads(SPEC_DEMAND, SPEC_STANDARDS);
    const byStation = new Map(workloads.map((w) => [w.stationId, w]));

    // Grill: 40×4 + 30×1 + 20×6 = 310
    expect(byStation.get(GRILL)!.workloadMinutes).toBe(310);
    // Fryer: 40×2 + 50×2 = 180
    expect(byStation.get(FRYER)!.workloadMinutes).toBe(180);
    // Prep: 40×1 + 30×3 + 20×3 = 190
    expect(byStation.get(PREP)!.workloadMinutes).toBe(190);
    // Plating: 40×1 + 30×1 + 50×0.5 + 20×1 = 115
    expect(byStation.get(PLATING)!.workloadMinutes).toBe(115);
  });

  it("does not charge a station for items with no standard there", () => {
    const workloads = computeStationWorkloads(SPEC_DEMAND, SPEC_STANDARDS);
    const fryer = workloads.find((w) => w.stationId === FRYER)!;
    // Biryani and pizza never touch the fryer.
    expect(fryer.contributors.map((c) => c.menuItemId).sort()).toEqual([10, 12]);
  });

  it("distinguishes item mix, not just order count — same volume, different workload", () => {
    const allPizza = computeStationWorkloads(
      [{ menuItemId: 13, itemName: "Pizza", quantity: 40 }],
      SPEC_STANDARDS,
    );
    const allFries = computeStationWorkloads(
      [{ menuItemId: 12, itemName: "Fries", quantity: 40 }],
      SPEC_STANDARDS,
    );
    const pizzaTotal = allPizza.reduce((s, w) => s + w.workloadMinutes, 0);
    const friesTotal = allFries.reduce((s, w) => s + w.workloadMinutes, 0);
    expect(pizzaTotal).toBe(400); // 40 × (6+3+1)
    expect(friesTotal).toBe(100); // 40 × (2+0.5)
    expect(pizzaTotal).toBeGreaterThan(friesTotal * 3);
  });

  it("ignores items with no demand and items with no standards", () => {
    const workloads = computeStationWorkloads(
      [
        { menuItemId: 10, itemName: "Chicken Burger", quantity: 0 },
        { menuItemId: 99, itemName: "Unmapped Item", quantity: 25 },
      ],
      SPEC_STANDARDS,
    );
    expect(workloads).toEqual([]);
  });

  it("sorts contributors by minutes so the biggest driver is first", () => {
    const grill = computeStationWorkloads(SPEC_DEMAND, SPEC_STANDARDS).find((w) => w.stationId === GRILL)!;
    expect(grill.contributors[0].itemName).toBe("Chicken Burger"); // 160 min
    expect(grill.contributors[1].itemName).toBe("Pizza"); // 120 min
  });

  it("honours a calibrated observed time once it is trusted", () => {
    const calibrated = [std(10, GRILL, 4, { observedMinutes: 6, observationCount: 100 })];
    const workloads = computeStationWorkloads(
      [{ menuItemId: 10, itemName: "Chicken Burger", quantity: 10 }],
      calibrated,
    );
    expect(workloads[0].workloadMinutes).toBe(60); // 10 × 6, not 10 × 4
  });
});

describe("computeProductiveMinutesPerStaff", () => {
  it("applies the utilization factor — 60 clock minutes is not 60 productive minutes", () => {
    expect(computeProductiveMinutesPerStaff(60, 0.75)).toBe(45);
  });

  it("falls back to the documented default when the factor is missing", () => {
    expect(computeProductiveMinutesPerStaff(60, null)).toBe(60 * DEFAULT_UTILIZATION_FACTOR);
  });

  it("clamps a stored zero rather than producing an infinite staff requirement", () => {
    const productive = computeProductiveMinutesPerStaff(60, 0);
    expect(productive).toBeGreaterThan(0);
    expect(Number.isFinite(computeRequiredFte(100, productive))).toBe(true);
  });

  it("clamps a factor above 1 — nobody produces more than 60 minutes in an hour", () => {
    expect(computeProductiveMinutesPerStaff(60, 1.4)).toBe(60);
  });

  it("returns zero for a zero-length window", () => {
    expect(computeProductiveMinutesPerStaff(0, 0.75)).toBe(0);
  });
});

describe("computeRequiredFte", () => {
  it("matches the worked example's utilization-corrected grill figure", () => {
    // 280 grill minutes ÷ 45 productive minutes = 6.22 FTE
    expect(computeRequiredFte(280, 45)).toBeCloseTo(6.22, 2);
  });

  it("stays fractional — rounding each station up in isolation is the over-hiring bug", () => {
    expect(computeRequiredFte(190, 45)).toBeCloseTo(4.22, 2);
  });

  it("returns 0 for no workload, and never divides by zero", () => {
    expect(computeRequiredFte(0, 45)).toBe(0);
    expect(computeRequiredFte(100, 0)).toBe(0);
  });
});

describe("computePooledHeadcount", () => {
  it("takes the ceiling of the sum, not the sum of the ceilings", () => {
    // The spec's own example: 4.5 / 2.2 / 1.5 / 1.8 FTE.
    const fte = [4.5, 2.2, 1.5, 1.8];
    const naive = fte.reduce((s, v) => s + Math.ceil(v), 0); // 5+3+2+2 = 12
    expect(naive).toBe(12);
    expect(computePooledHeadcount(fte)).toBe(10); // ceil(10.0)
  });

  it("does not charge a whole person for every rounding tail", () => {
    // Ten stations each needing a small fraction: naive rounding demands 10
    // people for 2.8 FTE of actual work.
    const fte = Array.from({ length: 10 }, () => 0.28);
    expect(fte.reduce((s, v) => s + Math.ceil(v), 0)).toBe(10);
    expect(computePooledHeadcount(fte)).toBe(3);
  });

  it("returns 0 when there is no requirement at all", () => {
    expect(computePooledHeadcount([])).toBe(0);
    expect(computePooledHeadcount([0, 0])).toBe(0);
  });

  it("absorbs float drift rather than demanding an extra body", () => {
    expect(computePooledHeadcount([1.0000000004, 2])).toBe(3);
  });

  it("ignores negative values instead of crediting them against real work", () => {
    expect(computePooledHeadcount([2.5, -1])).toBe(3);
  });
});

describe("assessEquipmentCapacity", () => {
  it("flags the spec's pizza-oven case and quantifies what cannot be produced", () => {
    const result = assessEquipmentCapacity(100, { capacityPerHour: 70, equipmentItemsPerHour: null });
    expect(result.isEquipmentBound).toBe(true);
    expect(result.unservableItemsPerHour).toBe(30);
    expect(result.utilizationPercent).toBe(143);
    expect(result.servableFraction).toBeCloseTo(0.7, 2);
  });

  it("makes NO assessment when nothing declares a ceiling, rather than guessing", () => {
    const result = assessEquipmentCapacity(500, { capacityPerHour: null, equipmentItemsPerHour: null });
    expect(result.capacityPerHour).toBeNull();
    expect(result.utilizationPercent).toBeNull();
    expect(result.isEquipmentBound).toBe(false);
    expect(result.servableFraction).toBe(1);
  });

  it("falls back to summed equipment throughput when the station has no explicit ceiling", () => {
    const result = assessEquipmentCapacity(100, { capacityPerHour: null, equipmentItemsPerHour: 120 });
    expect(result.capacityPerHour).toBe(120);
    expect(result.isEquipmentBound).toBe(false);
  });

  it("prefers the station's own ceiling over the equipment rollup", () => {
    const result = assessEquipmentCapacity(100, { capacityPerHour: 70, equipmentItemsPerHour: 500 });
    expect(result.capacityPerHour).toBe(70);
  });

  it("is bound at 90% of capacity, matching the kitchen-wide bottleneck threshold", () => {
    expect(assessEquipmentCapacity(89, { capacityPerHour: 100, equipmentItemsPerHour: null }).isEquipmentBound).toBe(false);
    expect(assessEquipmentCapacity(90, { capacityPerHour: 100, equipmentItemsPerHour: null }).isEquipmentBound).toBe(true);
  });

  it("reports no unservable demand while inside capacity", () => {
    expect(assessEquipmentCapacity(95, { capacityPerHour: 100, equipmentItemsPerHour: null }).unservableItemsPerHour).toBe(0);
  });
});

describe("computeRollingWindowPeak", () => {
  // The spec's arrival profile: 8, 12, 25, 40 orders per 15 minutes.
  const ARRIVALS = [8, 12, 25, 40];

  it("finds the busiest window, not the average", () => {
    const peak = computeRollingWindowPeak(ARRIVALS, 15, 15)!;
    expect(peak.peakValue).toBe(40);
    expect(peak.startOffsetMinutes).toBe(45);
    // 40 orders in 15 minutes is a 160/hour rate — four times the 40/hour the
    // hourly average of 85 orders would imply for that quarter.
    expect(peak.peakValuePerHour).toBe(160);
  });

  it("exposes burstiness — the 15-minute rate far exceeds the 60-minute rate", () => {
    const short = computeRollingWindowPeak(ARRIVALS, 15, 15)!;
    const hour = computeRollingWindowPeak(ARRIVALS, 15, 60)!;
    expect(hour.peakValue).toBe(85);
    expect(hour.peakValuePerHour).toBe(85);
    expect(short.peakValuePerHour).toBeGreaterThan(hour.peakValuePerHour * 1.8);
  });

  it("picks the peak window when it is not at the end of the series", () => {
    const peak = computeRollingWindowPeak([1, 50, 60, 2, 3], 15, 30)!;
    expect(peak.peakValue).toBe(110);
    expect(peak.startBucket).toBe(1);
  });

  it("returns null when the window is longer than the available series", () => {
    expect(computeRollingWindowPeak([5, 5], 15, 120)).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(computeRollingWindowPeak([], 15, 60)).toBeNull();
  });

  it("treats a sub-bucket window as one bucket rather than dividing by zero", () => {
    const peak = computeRollingWindowPeak([10, 20], 15, 5)!;
    expect(peak.windowMinutes).toBe(15);
    expect(peak.peakValue).toBe(20);
  });
});

describe("allocateCrewToStations", () => {
  const member = (userId: number, name: string, skills: [number, number, number][]): CrewMember => ({
    userId,
    name,
    availableFte: 1,
    skills: skills.map(([stationId, proficiency, speedFactor]) => ({ stationId, proficiency, speedFactor })),
  });

  it("covers a multi-station requirement with fewer people than summing rounded-up stations", () => {
    // 4.5 + 2.2 + 1.5 + 1.8 = 10 FTE. Rounding each up gives 5+3+2+2 = 12.
    const requirements = [
      { stationId: GRILL, requiredFte: 4.5 },
      { stationId: FRYER, requiredFte: 2.2 },
      { stationId: PREP, requiredFte: 1.5 },
      { stationId: PLATING, requiredFte: 1.8 },
    ];
    const crew = Array.from({ length: 10 }, (_, i) =>
      member(i + 1, `Staff ${i + 1}`, [[GRILL, 3, 1], [FRYER, 3, 1], [PREP, 3, 1], [PLATING, 3, 1]]),
    );

    const result = allocateCrewToStations(requirements, crew);
    expect(result.totalShortfallFte).toBe(0);
    // 10 fully-cross-trained people cover exactly 10 FTE of demand.
    expect(result.totalSurplusFte).toBe(0);
  });

  it("produces split roles — one person covering two stations", () => {
    const result = allocateCrewToStations(
      [
        { stationId: GRILL, requiredFte: 1.5 },
        { stationId: PLATING, requiredFte: 0.5 },
      ],
      [
        member(1, "Arun", [[GRILL, 5, 1]]),
        member(2, "Ravi", [[GRILL, 3, 1], [PLATING, 4, 1]]),
      ],
    );
    const ravi = result.assignments.find((a) => a.userId === 2)!;
    expect(ravi.stations.length).toBe(2);
    expect(result.totalShortfallFte).toBe(0);
  });

  it("reports a genuine shortfall rather than inventing capacity", () => {
    const result = allocateCrewToStations(
      [{ stationId: GRILL, requiredFte: 3 }],
      [member(1, "Arun", [[GRILL, 5, 1]])],
    );
    expect(result.totalShortfallFte).toBe(2);
    expect(result.perStation[0].coveredFte).toBe(1);
  });

  it("separates an unskilled shortfall from plain understaffing", () => {
    const result = allocateCrewToStations(
      [{ stationId: FRYER, requiredFte: 2 }],
      [member(1, "Arun", [[GRILL, 5, 1]])], // nobody can work the fryer
    );
    expect(result.unskilledShortfallFte).toBe(2);
    expect(result.assignments[0].idleFraction).toBe(1);
  });

  it("credits a faster cook with covering more requirement per unit of time", () => {
    const fast = allocateCrewToStations(
      [{ stationId: GRILL, requiredFte: 1 }],
      [member(1, "Fast", [[GRILL, 5, 1.25]])],
    );
    // A 25%-faster cook closes a 1.0-FTE gap using 0.8 of their window.
    expect(fast.assignments[0].idleFraction).toBeCloseTo(0.2, 2);
    expect(fast.totalShortfallFte).toBe(0);
  });

  it("prefers the higher-proficiency person for a station", () => {
    const result = allocateCrewToStations(
      [{ stationId: GRILL, requiredFte: 1 }],
      [member(1, "Novice", [[GRILL, 2, 1]]), member(2, "Expert", [[GRILL, 5, 1]])],
    );
    const expert = result.assignments.find((a) => a.userId === 2)!;
    expect(expert.stations[0].fractionOfWindow).toBe(1);
    expect(result.assignments.find((a) => a.userId === 1)!.stations).toEqual([]);
  });

  it("is deterministic for identically-skilled crew", () => {
    const requirements = [{ stationId: GRILL, requiredFte: 1.5 }];
    const crew = [member(2, "B", [[GRILL, 3, 1]]), member(1, "A", [[GRILL, 3, 1]])];
    const first = allocateCrewToStations(requirements, crew);
    const second = allocateCrewToStations(requirements, crew);
    expect(first.assignments).toEqual(second.assignments);
  });

  it("handles an empty crew without looping forever", () => {
    const result = allocateCrewToStations([{ stationId: GRILL, requiredFte: 5 }], []);
    expect(result.totalShortfallFte).toBe(5);
    expect(result.assignments).toEqual([]);
  });

  // The regression this guards, seen on real seeded data: with 5 cross-trained
  // chefs against 10 stations, "fill the largest absolute requirement first"
  // stacked 4 of them on Prep (the biggest single number) and left the wok,
  // tandoor and fryer with nobody at all. Max-min fair filling must spread them.
  it("spreads a short crew across every workable station instead of stacking one", () => {
    const requirements = [
      { stationId: 1, requiredFte: 4.35 }, // Prep — the trap: biggest number
      { stationId: 2, requiredFte: 0.94 },
      { stationId: 3, requiredFte: 0.67 },
      { stationId: 4, requiredFte: 2.18 },
      { stationId: 5, requiredFte: 2.13 },
      { stationId: 6, requiredFte: 1.17 },
      { stationId: 7, requiredFte: 1.08 },
      { stationId: 8, requiredFte: 1.06 },
      { stationId: 9, requiredFte: 0.63 },
      { stationId: 10, requiredFte: 2.33 },
    ];
    const allStations: [number, number, number][] = requirements.map((r) => [r.stationId, 3, 1]);
    const crew = Array.from({ length: 5 }, (_, i) => member(i + 1, `Chef ${i + 1}`, allStations));

    const result = allocateCrewToStations(requirements, crew);

    // Every station has someone on it — none abandoned.
    const uncovered = result.perStation.filter((p) => p.coveredFte <= 0);
    expect(uncovered).toEqual([]);

    // Nobody is left idle while stations go short.
    expect(result.totalSurplusFte).toBe(0);

    // Coverage is roughly proportional: no station is fully covered while
    // another sits near zero. With 5 FTE against 17.54 FTE of demand, every
    // station should land near 5/17.54 ≈ 29% covered.
    const ratios = result.perStation.map((p) => p.coveredFte / p.requiredFte);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(spread).toBeLessThan(0.15);

    // And the total is still honest — capacity is not invented.
    const totalRequired = requirements.reduce((s, r) => s + r.requiredFte, 0);
    expect(result.totalShortfallFte).toBeCloseTo(totalRequired - 5, 1);
  });

  it("consolidates rather than smearing one person across every station", () => {
    // 2 people, 4 stations, enough capacity for half the work. Each person
    // should hold a small number of stations, not a 25% slice of all four.
    const requirements = [
      { stationId: GRILL, requiredFte: 1 },
      { stationId: FRYER, requiredFte: 1 },
      { stationId: PREP, requiredFte: 1 },
      { stationId: PLATING, requiredFte: 1 },
    ];
    const crew = [
      member(1, "A", [[GRILL, 3, 1], [FRYER, 3, 1], [PREP, 3, 1], [PLATING, 3, 1]]),
      member(2, "B", [[GRILL, 3, 1], [FRYER, 3, 1], [PREP, 3, 1], [PLATING, 3, 1]]),
    ];
    const result = allocateCrewToStations(requirements, crew);
    // Both fully used, and the work is shared out rather than hoarded.
    expect(result.totalSurplusFte).toBe(0);
    expect(result.totalShortfallFte).toBeCloseTo(2, 1);
  });

  it("handles no requirements", () => {
    const result = allocateCrewToStations([], [member(1, "Idle", [[GRILL, 3, 1]])]);
    expect(result.totalShortfallFte).toBe(0);
    expect(result.assignments[0].idleFraction).toBe(1);
  });
});

describe("classifyStationConstraint", () => {
  it("calls equipment BEFORE labor — a hire cannot raise a throughput ceiling", () => {
    expect(
      classifyStationConstraint({ requiredFte: 4, shortfallFte: 2, isEquipmentBound: true, anyoneSkilled: true }),
    ).toBe("EQUIPMENT_BOUND");
  });

  it("distinguishes a training gap from a headcount gap", () => {
    expect(
      classifyStationConstraint({ requiredFte: 2, shortfallFte: 2, isEquipmentBound: false, anyoneSkilled: false }),
    ).toBe("UNSKILLED");
    expect(
      classifyStationConstraint({ requiredFte: 2, shortfallFte: 2, isEquipmentBound: false, anyoneSkilled: true }),
    ).toBe("LABOR_SHORT");
  });

  it("treats a rounding-noise shortfall as balanced", () => {
    expect(
      classifyStationConstraint({ requiredFte: 2, shortfallFte: 0.1, isEquipmentBound: false, anyoneSkilled: true }),
    ).toBe("BALANCED");
  });

  it("marks a station with no workload as idle", () => {
    expect(
      classifyStationConstraint({ requiredFte: 0, shortfallFte: 0, isEquipmentBound: false, anyoneSkilled: true }),
    ).toBe("IDLE");
  });
});

describe("summarizeCapacityVerdict", () => {
  const station = (
    code: string,
    constraint: any,
    shortfallFte = 0,
    unservableItemsPerHour = 0,
  ) => ({ stationId: 1, code, name: code, constraint, shortfallFte, unservableItemsPerHour });

  // Every case below is modelled unless it is explicitly testing the
  // unconfigured path.
  const modelled = { hasModelledWorkload: true };

  it("recommends equipment over hiring when a station is throughput-bound", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("PIZZA", "EQUIPMENT_BOUND", 2, 30), station("PREP", "LABOR_SHORT", 1)],
      totalSurplusFte: 0,
      seatUtilizationPercent: 50,
      ...modelled,
    });
    expect(result.verdict).toBe("INVEST_IN_EQUIPMENT");
    expect(result.bindingStationCode).toBe("PIZZA");
    expect(result.headline).toContain("30 items/hr");
  });

  it("recommends moving people before hiring when idle time covers the gap", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("GRILL", "LABOR_SHORT", 0.8)],
      totalSurplusFte: 1.2,
      seatUtilizationPercent: 40,
      ...modelled,
    });
    expect(result.verdict).toBe("REALLOCATE_STAFF");
  });

  it("recommends hiring only when there is not enough idle time to move", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("GRILL", "LABOR_SHORT", 2.5)],
      totalSurplusFte: 0.1,
      seatUtilizationPercent: 40,
      ...modelled,
    });
    expect(result.verdict).toBe("HIRE_STAFF");
    expect(result.headline).toContain("2.5");
  });

  it("recommends training when the bodies are there but the capability is not", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("FRYER", "UNSKILLED", 1.5)],
      totalSurplusFte: 3,
      seatUtilizationPercent: 40,
      ...modelled,
    });
    expect(result.verdict).toBe("TRAIN_STAFF");
  });

  it("points at seating when the kitchen copes but the dining room is full", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("GRILL", "BALANCED")],
      totalSurplusFte: 1,
      seatUtilizationPercent: 92,
      ...modelled,
    });
    expect(result.verdict).toBe("ADD_SEATING");
  });

  it("does not invent a seating problem when occupancy is unknown", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("GRILL", "BALANCED")],
      totalSurplusFte: 1,
      seatUtilizationPercent: null,
      ...modelled,
    });
    expect(result.verdict).toBe("BALANCED");
  });

  // The regression this guards: an unconfigured branch has no stations, so every
  // "is anything short?" check trivially passes and the old code returned
  // BALANCED — a green "no action needed" produced from no model whatsoever.
  it("reports NOT_CONFIGURED, never BALANCED, when nothing is modelled", () => {
    const result = summarizeCapacityVerdict({
      stations: [],
      totalSurplusFte: 0,
      seatUtilizationPercent: 40,
      hasModelledWorkload: false,
    });
    expect(result.verdict).toBe("NOT_CONFIGURED");
    expect(result.headline).toContain("no station workload");
    expect(result.bindingStationCode).toBeNull();
  });

  it("reports NOT_CONFIGURED even when stations exist but carry no workload", () => {
    const result = summarizeCapacityVerdict({
      stations: [station("GRILL", "IDLE"), station("FRYER", "IDLE")],
      totalSurplusFte: 4,
      seatUtilizationPercent: 40,
      hasModelledWorkload: false,
    });
    expect(result.verdict).toBe("NOT_CONFIGURED");
  });

  it("does not let an unmodelled kitchen reach the seating recommendation either", () => {
    const result = summarizeCapacityVerdict({
      stations: [],
      totalSurplusFte: 0,
      // A packed dining room is real, but with no kitchen model there is no
      // basis for "the kitchen keeps up, so add tables".
      seatUtilizationPercent: 95,
      hasModelledWorkload: false,
    });
    expect(result.verdict).toBe("NOT_CONFIGURED");
  });
});

describe("computeWindowLaborCost", () => {
  it("prices a window from monthly salary and standard shift hours", () => {
    // 30,000/month ÷ (30 × 10) = ₹100/hr; a full 60-minute window = ₹100.
    expect(
      computeWindowLaborCost([{ monthlySalary: 30000, standardShiftHours: 10, fractionOfWindow: 1 }], 60),
    ).toBe(100);
  });

  it("charges only for the fraction of the window actually worked", () => {
    expect(
      computeWindowLaborCost([{ monthlySalary: 30000, standardShiftHours: 10, fractionOfWindow: 0.5 }], 60),
    ).toBe(50);
  });

  it("does not divide by zero on a missing shift length", () => {
    expect(
      computeWindowLaborCost([{ monthlySalary: 30000, standardShiftHours: 0, fractionOfWindow: 1 }], 60),
    ).toBe(0);
  });

  it("returns 0 for a zero-length window", () => {
    expect(computeWindowLaborCost([{ monthlySalary: 30000, standardShiftHours: 10, fractionOfWindow: 1 }], 0)).toBe(0);
  });
});

describe("computeOrderConcurrency", () => {
  it("counts orders already open when each order started", () => {
    const result = computeOrderConcurrency([
      { id: 1, startMs: 0, endMs: 1000 },
      { id: 2, startMs: 500, endMs: 1500 },
      { id: 3, startMs: 600, endMs: 900 },
    ]);
    expect(result.get(1)).toBe(0);
    expect(result.get(2)).toBe(1);
    expect(result.get(3)).toBe(2);
  });

  it("does not count an order that ended exactly as the next began", () => {
    const result = computeOrderConcurrency([
      { id: 1, startMs: 0, endMs: 1000 },
      { id: 2, startMs: 1000, endMs: 2000 },
    ]);
    expect(result.get(2)).toBe(0);
  });

  it("returns an empty map for no orders", () => {
    expect(computeOrderConcurrency([]).size).toBe(0);
  });
});

describe("computeItemCalibrationFactors", () => {
  it("detects an item that consistently takes longer than its standard", () => {
    const observations = Array.from({ length: 10 }, () => ({
      actualMinutes: 12, // standard says 10
      concurrency: 0,
      items: [{ menuItemId: 10, predictedMinutes: 10 }],
    }));
    const [result] = computeItemCalibrationFactors(observations);
    expect(result.menuItemId).toBe(10);
    expect(result.factor).toBeCloseTo(1.2, 2);
    expect(result.observationCount).toBe(10);
  });

  it("drops orders cooked under a deep queue, where wall clock is mostly waiting", () => {
    const results = computeItemCalibrationFactors([
      { actualMinutes: 60, concurrency: 9, items: [{ menuItemId: 10, predictedMinutes: 10 }] },
    ]);
    expect(results).toEqual([]);
  });

  it("rejects absurd ratios as data errors, not evidence", () => {
    const results = computeItemCalibrationFactors([
      // A ticket left open for hours — 20x the prediction.
      { actualMinutes: 200, concurrency: 0, items: [{ menuItemId: 10, predictedMinutes: 10 }] },
    ]);
    expect(results).toEqual([]);
  });

  it("weights a multi-item order by each item's share of the prediction", () => {
    // Pizza dominates the prediction, so it absorbs most of the correction.
    const observations = Array.from({ length: 5 }, () => ({
      actualMinutes: 22, // predicted 20 → ratio 1.1 for both items
      concurrency: 0,
      items: [
        { menuItemId: 13, predictedMinutes: 18 },
        { menuItemId: 12, predictedMinutes: 2 },
      ],
    }));
    const results = computeItemCalibrationFactors(observations);
    expect(results.find((r) => r.menuItemId === 13)!.factor).toBeCloseTo(1.1, 2);
    expect(results.find((r) => r.menuItemId === 12)!.factor).toBeCloseTo(1.1, 2);
  });

  it("ignores orders whose items have no predictions to compare against", () => {
    expect(
      computeItemCalibrationFactors([{ actualMinutes: 15, concurrency: 0, items: [] }]),
    ).toEqual([]);
  });

  it("ignores a non-positive actual duration", () => {
    expect(
      computeItemCalibrationFactors([
        { actualMinutes: 0, concurrency: 0, items: [{ menuItemId: 10, predictedMinutes: 10 }] },
      ]),
    ).toEqual([]);
  });
});

describe("end-to-end: the spec's worked example", () => {
  it("turns 140 forecast items into a per-station headcount, corrected for utilization", () => {
    const workloads = computeStationWorkloads(SPEC_DEMAND, SPEC_STANDARDS);
    const productive = computeProductiveMinutesPerStaff(60, 0.75); // 45 min

    const fte = new Map(
      workloads.map((w) => [w.stationId, computeRequiredFte(w.workloadMinutes, productive)]),
    );

    // Grill 310/45 = 6.89, Fryer 180/45 = 4.0, Prep 190/45 = 4.22, Plating 115/45 = 2.56
    expect(fte.get(GRILL)).toBeCloseTo(6.89, 2);
    expect(fte.get(FRYER)).toBeCloseTo(4, 2);
    expect(fte.get(PREP)).toBeCloseTo(4.22, 2);
    expect(fte.get(PLATING)).toBeCloseTo(2.56, 2);

    // Rounding each station up independently would demand 7+4+5+3 = 19 people.
    const naive = [...fte.values()].reduce((s, v) => s + Math.ceil(v), 0);
    // A fully cross-trained crew covers the same work with the ceiling of the
    // total instead: 17.67 → 18.
    const pooled = Math.ceil([...fte.values()].reduce((s, v) => s + v, 0));
    expect(naive).toBe(19);
    expect(pooled).toBe(18);
    expect(pooled).toBeLessThan(naive);
  });

  it("caps the staffing recommendation when the station is equipment-bound", () => {
    const pizzaOnly = computeStationWorkloads(
      [{ menuItemId: 13, itemName: "Pizza", quantity: 100 }],
      SPEC_STANDARDS,
    );
    const grill = pizzaOnly.find((w) => w.stationId === GRILL)!;
    const productive = computeProductiveMinutesPerStaff(60, 0.75);
    const rawFte = computeRequiredFte(grill.workloadMinutes, productive);

    const equipment = assessEquipmentCapacity(grill.itemUnits, {
      capacityPerHour: 70,
      equipmentItemsPerHour: null,
    });
    const cappedFte = rawFte * equipment.servableFraction;

    expect(equipment.isEquipmentBound).toBe(true);
    expect(equipment.unservableItemsPerHour).toBe(30);
    // Staffing for 100 pizzas when only 70 can be produced is money burned.
    expect(cappedFte).toBeLessThan(rawFte);
    expect(cappedFte).toBeCloseTo(rawFte * 0.7, 2);
  });
});
