import { describe, expect, it } from "vitest";
import {
  branchUnderperformingPeersRisk,
  decliningCustomerGrowthRisk,
  delayedInvestmentPaybackRisks,
  delayLowReturnInvestmentRecommendations,
  detectAnomaly,
  expandHighPerformingBranchRecommendation,
  fallingProfitabilityRisk,
  foodCostTargetInsight,
  healthyMarginOpportunity,
  highGrowthBranchOpportunity,
  improvingForecastTrendOpportunity,
  lowForecastConfidenceRisk,
  persistentBudgetMissRisks,
  revenueChangeInsight,
  risingCostRisk,
  strongROIInvestmentOpportunities,
  weakBusinessHealthRisk,
} from "./ai.rules";
import { KpiRuleInput } from "./ai.types";

const kpi = (overrides: Partial<KpiRuleInput> & { key: string; label: string; unit: KpiRuleInput["unit"] }): KpiRuleInput => ({
  higherIsBetter: true, current: null, ...overrides,
});

describe("revenueChangeInsight", () => {
  it("reports a revenue increase with the real current/previous figures, high confidence, info severity", () => {
    const insight = revenueChangeInsight(kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 2200, previousPeriod: 2000, variancePercentage: 10 }), ["/dashboard/financial-statements"]);
    expect(insight).not.toBeNull();
    expect(insight!.summary).toContain("increased by 10.0%");
    expect(insight!.summary).toContain("2,200");
    expect(insight!.summary).toContain("2,000");
    expect(insight!.severity).toBe("info");
    expect(insight!.confidence).toBe("high");
  });

  it("reports a revenue decrease as medium/high severity depending on magnitude", () => {
    const small = revenueChangeInsight(kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 1900, previousPeriod: 2000, variancePercentage: -5 }), []);
    expect(small!.severity).toBe("medium");
    const big = revenueChangeInsight(kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 1600, previousPeriod: 2000, variancePercentage: -20 }), []);
    expect(big!.severity).toBe("high");
  });

  it("returns null for a negligible change (not worth surfacing)", () => {
    expect(revenueChangeInsight(kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 2010, previousPeriod: 2000, variancePercentage: 0.5 }), [])).toBeNull();
  });

  it("returns null when there's no previous-period data to compare against", () => {
    expect(revenueChangeInsight(kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 2000, previousPeriod: null }), [])).toBeNull();
  });
});

describe("foodCostTargetInsight", () => {
  it("flags food cost above target with the exact gap and both real figures", () => {
    const insight = foodCostTargetInsight(
      kpi({ key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", current: 34.2, target: 30 }),
      kpi({ key: "revenue", label: "Revenue", unit: "currency", current: 2000, variancePercentage: 1 }),
      [],
    );
    expect(insight).not.toBeNull();
    expect(insight!.summary).toContain("34.2%");
    expect(insight!.summary).toContain("4.2 points above the 30.0% target");
    expect(insight!.summary).toContain("mainly because ingredient costs increased while sales remained stable");
    expect(insight!.category).toBe("risk");
  });

  it("returns null when within a reasonable tolerance of target", () => {
    expect(foodCostTargetInsight(kpi({ key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", current: 30.3, target: 30 }), kpi({ key: "revenue", label: "Revenue", unit: "currency" }), [])).toBeNull();
  });

  it("returns null when no target is configured", () => {
    expect(foodCostTargetInsight(kpi({ key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", current: 40, target: null }), kpi({ key: "revenue", label: "Revenue", unit: "currency" }), [])).toBeNull();
  });
});

describe("detectAnomaly", () => {
  const stableHistory = [100, 102, 98, 101, 99, 103];

  it("flags a value far outside the historical mean/stdDev as anomalous", () => {
    const insight = detectAnomaly("Revenue", "revenue", "currency", stableHistory, 200, true, []);
    expect(insight).not.toBeNull();
    expect(insight!.category).toBe("anomaly");
    expect(insight!.title).toContain("Increase");
  });

  it("does not flag a value within normal historical variation", () => {
    expect(detectAnomaly("Revenue", "revenue", "currency", stableHistory, 101, true, [])).toBeNull();
  });

  it("treats an anomalous improvement (higherIsBetter direction) as informational, not a risk", () => {
    const insight = detectAnomaly("Revenue", "revenue", "currency", stableHistory, 200, true, []);
    expect(insight!.severity).toBe("info");
  });

  it("treats an anomalous decline as a real severity, not informational", () => {
    const insight = detectAnomaly("Revenue", "revenue", "currency", stableHistory, 10, true, []);
    expect(insight!.severity).not.toBe("info");
  });

  it("returns null with fewer than 3 historical points", () => {
    expect(detectAnomaly("Revenue", "revenue", "currency", [100, 100], 500, true, [])).toBeNull();
  });

  it("returns null when the historical series has zero variation (nothing to compare against)", () => {
    expect(detectAnomaly("Revenue", "revenue", "currency", [100, 100, 100], 500, true, [])).toBeNull();
  });

  it("returns null for a null current value", () => {
    expect(detectAnomaly("Revenue", "revenue", "currency", stableHistory, null, true, [])).toBeNull();
  });
});

describe("fallingProfitabilityRisk / risingCostRisk", () => {
  it("flags falling profitability only when the trend is down by a meaningful margin", () => {
    expect(fallingProfitabilityRisk(kpi({ key: "netProfit", label: "Net Profit", unit: "currency", current: 800, previousPeriod: 1000, trendDirection: "down", variancePercentage: -20 }), [])).not.toBeNull();
    expect(fallingProfitabilityRisk(kpi({ key: "netProfit", label: "Net Profit", unit: "currency", trendDirection: "down", variancePercentage: -2 }), [])).toBeNull();
    expect(fallingProfitabilityRisk(kpi({ key: "netProfit", label: "Net Profit", unit: "currency", trendDirection: "up", variancePercentage: 20 }), [])).toBeNull();
  });

  it("labels a rising labour cost with a labour-specific recommendation, and food cost with a food-specific one", () => {
    const labour = risingCostRisk(kpi({ key: "labourCostPercentage", label: "Labour Cost %", unit: "percentage", current: 30, previousPeriod: 25, trendDirection: "up", variancePercentage: 20 }), "Labour Cost %", []);
    expect(labour!.recommendedActions[0]).toMatch(/staffing/i);
    const food = risingCostRisk(kpi({ key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", current: 35, previousPeriod: 30, trendDirection: "up", variancePercentage: 16.7 }), "Food Cost %", []);
    expect(food!.recommendedActions[0]).toMatch(/supplier|wastage/i);
  });
});

describe("lowForecastConfidenceRisk", () => {
  it("flags a low-confidence forecast and surfaces its first reason", () => {
    const insight = lowForecastConfidenceRisk({ overallConfidence: "low", confidenceReasons: ["Insufficient history — only 2 periods available"] }, []);
    expect(insight).not.toBeNull();
    expect(insight!.summary).toContain("insufficient history");
  });

  it("returns null for medium/high confidence", () => {
    expect(lowForecastConfidenceRisk({ overallConfidence: "high", confidenceReasons: [] }, [])).toBeNull();
    expect(lowForecastConfidenceRisk(null, [])).toBeNull();
  });
});

describe("delayedInvestmentPaybackRisks / persistentBudgetMissRisks", () => {
  it("produces one risk insight per underperforming investment", () => {
    const risks = delayedInvestmentPaybackRisks([{ project: { name: "New Kitchen" }, metrics: { npv: -5000, paybackPeriodYears: null } }], []);
    expect(risks).toHaveLength(1);
    expect(risks[0].summary).toContain("New Kitchen");
    expect(risks[0].summary).toContain("negative NPV");
  });

  it("produces one critical risk per critically-off-budget category", () => {
    const risks = persistentBudgetMissRisks([{ label: "Food Cost %", achievementPercentage: 60 }], []);
    expect(risks).toHaveLength(1);
    expect(risks[0].severity).toBe("critical");
  });
});

describe("weakBusinessHealthRisk", () => {
  it("flags a health score below 50, critical below 30", () => {
    expect(weakBusinessHealthRisk({ overall: 45, status: "warning" }, [])!.severity).toBe("high");
    expect(weakBusinessHealthRisk({ overall: 20, status: "critical" }, [])!.severity).toBe("critical");
  });

  it("returns null for a healthy score", () => {
    expect(weakBusinessHealthRisk({ overall: 75, status: "good" }, [])).toBeNull();
  });
});

describe("decliningCustomerGrowthRisk", () => {
  it("assigns severity across all four tiers based on the magnitude of the decline", () => {
    expect(decliningCustomerGrowthRisk(kpi({ key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: -2 }), [])!.severity).toBe("low");
    expect(decliningCustomerGrowthRisk(kpi({ key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: -7 }), [])!.severity).toBe("medium");
    expect(decliningCustomerGrowthRisk(kpi({ key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: -15 }), [])!.severity).toBe("high");
    expect(decliningCustomerGrowthRisk(kpi({ key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: -25 }), [])!.severity).toBe("critical");
  });

  it("returns null when customer growth is flat or positive", () => {
    expect(decliningCustomerGrowthRisk(kpi({ key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: 5 }), [])).toBeNull();
  });
});

describe("branchUnderperformingPeersRisk", () => {
  it("flags a branch whose health score is significantly below the network average", () => {
    const insight = branchUnderperformingPeersRisk({ branch: { name: "Branch C" }, healthScore: 40 }, 70, []);
    expect(insight).not.toBeNull();
    expect(insight!.summary).toContain("Branch C");
    expect(insight!.summary).toContain("30 points below");
  });

  it("returns null when the gap isn't significant", () => {
    expect(branchUnderperformingPeersRisk({ branch: { name: "Branch C" }, healthScore: 65 }, 70, [])).toBeNull();
  });
});

describe("opportunity rules", () => {
  it("highGrowthBranchOpportunity flags meaningful growth only", () => {
    expect(highGrowthBranchOpportunity({ branch: { name: "Branch A" }, revenueTrendPercentage: 12 }, [])).not.toBeNull();
    expect(highGrowthBranchOpportunity({ branch: { name: "Branch A" }, revenueTrendPercentage: 1 }, [])).toBeNull();
  });

  it("strongROIInvestmentOpportunities only includes projects above the ROI threshold", () => {
    const opportunities = strongROIInvestmentOpportunities([
      { project: { name: "Strong" }, metrics: { roiPercentage: 45, npv: 20000 } },
      { project: { name: "Weak" }, metrics: { roiPercentage: 5, npv: 200 } },
    ], []);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].summary).toContain("Strong");
  });

  it("improvingForecastTrendOpportunity requires an upward trend of at least 5%", () => {
    expect(improvingForecastTrendOpportunity({ trendDirection: "up", variancePercentage: 8 }, [])).not.toBeNull();
    expect(improvingForecastTrendOpportunity({ trendDirection: "down", variancePercentage: 8 }, [])).toBeNull();
  });

  it("healthyMarginOpportunity requires beating EBITDA target by at least 10 points of achievement", () => {
    expect(healthyMarginOpportunity(kpi({ key: "ebitdaPercentage", label: "EBITDA %", unit: "percentage", current: 25, achievementPercentage: 125 }), [])).not.toBeNull();
    expect(healthyMarginOpportunity(kpi({ key: "ebitdaPercentage", label: "EBITDA %", unit: "percentage", current: 20, achievementPercentage: 100 }), [])).toBeNull();
  });
});

describe("recommendation rules", () => {
  it("expandHighPerformingBranchRecommendation requires a health score of at least 80", () => {
    expect(expandHighPerformingBranchRecommendation({ branch: { name: "Branch A" }, healthScore: 85 }, [])).not.toBeNull();
    expect(expandHighPerformingBranchRecommendation({ branch: { name: "Branch A" }, healthScore: 60 }, [])).toBeNull();
  });

  it("delayLowReturnInvestmentRecommendations only includes negative-NPV projects", () => {
    const recs = delayLowReturnInvestmentRecommendations([
      { project: { name: "Bad Idea" }, metrics: { npv: -1000 } },
      { project: { name: "Good Idea" }, metrics: { npv: 5000 } },
    ], []);
    expect(recs).toHaveLength(1);
    expect(recs[0].summary).toContain("Bad Idea");
  });
});
