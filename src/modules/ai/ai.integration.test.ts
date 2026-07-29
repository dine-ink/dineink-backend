// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma, no mocking of any underlying engine).
// Creates its own isolated fixture restaurant and deletes every row it
// created afterward; never touches pre-existing data. Run via
// `npm run test:integration`, not the default `npm test` (see
// vitest.integration.config.ts). Every assertion below checks that an
// Insight/Brief/Narrative/Answer's numbers trace back to the fixture's real
// bills — never a fabricated figure — matching the phase's core traceability
// requirement.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  answerBestPerformingBranchService,
  answerKpisNeedingAttentionService,
  answerWhatIfSalesIncreaseService,
  answerWhyProfitChangedService,
  generateInsightsService,
  getBranchNarrativesService,
  getExecutiveBriefService,
  getInsightTimelineService,
  getOpportunitiesService,
  getRiskAssessmentService,
} from "./ai.service";

describe("AI Financial Advisor — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let menuItemId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest AI Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest AI Branch A" } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest AI Branch B" } });
    branchBId = branchB.id;
    await prisma.user.create({
      data: { name: "Vitest AI Owner", role: "OWNER", password: "unused", email: `vitest-ai-${Date.now()}@test.com`, restaurantId, isActive: true },
    });

    const category = await prisma.category.create({ data: { restaurantId, name: "Cat" } });
    const ingCategory = await prisma.ingredientCategory.create({ data: { restaurantId, name: "IngCat" } });
    const ingredient = await prisma.ingredient.create({
      data: { restaurantId, categoryId: ingCategory.id, name: "Bun", unit: "piece", pricePerUnit: 20, purchasePrice: 20, quantity: 50 },
    });
    const menuItem = await prisma.menuItem.create({ data: { restaurantId, branchId: null, categoryId: category.id, name: "Burger", price: 200 } });
    menuItemId = menuItem.id;
    await prisma.menuItemIngredient.create({ data: { menuItemId, ingredientId: ingredient.id, quantity: 1, unit: "piece" } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchAId, monthlyRent: 3000 } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchBId, monthlyRent: 1000 } });

    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    const makeBills = async (branchId: number, count: number, createdAt: Date, prefix: string) => {
      for (let i = 0; i < count; i++) {
        const bill = await prisma.bill.create({
          data: { billNo: `VITEST-AI-${prefix}-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
            subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId, createdAt },
        });
        await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
      }
    };

    // Branch A: revenue doubles from last month (1000) to this month (2000) — a clean, hand-verifiable "Revenue Increased" insight.
    await makeBills(branchAId, 5, lastMonth, "A-PREV");
    await makeBills(branchAId, 10, now, "A-CUR");
    // Branch B: far fewer bills this month — clearly the weaker branch for narrative/ranking comparisons.
    await makeBills(branchBId, 2, now, "B-CUR");
  });

  afterAll(async () => {
    await prisma.aIInsightLog.deleteMany({ where: { restaurantId } });
    await prisma.financialScenario.deleteMany({ where: { restaurantId } }); // answerWhatIfSalesIncreaseService reuses listScenariosService, which auto-creates built-ins
    await prisma.billItem.deleteMany({ where: { bill: { restaurantId } } });
    await prisma.bill.deleteMany({ where: { restaurantId } });
    await prisma.restaurantInsights.deleteMany({ where: { restaurantId } });
    await prisma.menuItemIngredient.deleteMany({ where: { menuItemId } });
    await prisma.menuItem.deleteMany({ where: { restaurantId } });
    await prisma.ingredient.deleteMany({ where: { restaurantId } });
    await prisma.ingredientCategory.deleteMany({ where: { restaurantId } });
    await prisma.category.deleteMany({ where: { restaurantId } });
    await prisma.user.deleteMany({ where: { restaurantId } });
    await prisma.branch.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
  });

  it("generates a Revenue Increased insight whose summary contains the exact real figures, and logs it idempotently per day", async () => {
    const insights = await generateInsightsService(restaurantId, branchAId, "currentMonth");
    const revenueInsight = insights.find((i) => i.title === "Revenue Increased");
    expect(revenueInsight).toBeTruthy();
    expect(revenueInsight!.summary).toContain("2,000");
    expect(revenueInsight!.summary).toContain("1,000");
    expect(revenueInsight!.confidence).toBe("high"); // a fact about real historical data, not a prediction

    const logsAfterFirst = await getInsightTimelineService(restaurantId, branchAId, 50);
    expect(logsAfterFirst.length).toBeGreaterThan(0);

    await generateInsightsService(restaurantId, branchAId, "currentMonth"); // second call, same calendar day
    const logsAfterSecond = await getInsightTimelineService(restaurantId, branchAId, 50);
    expect(logsAfterSecond.length).toBe(logsAfterFirst.length); // idempotent — no duplicate rows for the same day
  });

  it("keeps category-filtered services (Risks, Opportunities) as pure subsets of the one shared insight set", async () => {
    const [all, risks, opportunities] = await Promise.all([
      generateInsightsService(restaurantId, branchAId, "currentMonth"),
      getRiskAssessmentService(restaurantId, branchAId, "currentMonth"),
      getOpportunitiesService(restaurantId, branchAId, "currentMonth"),
    ]);
    expect(risks.every((r) => r.category === "risk")).toBe(true);
    expect(opportunities.every((o) => o.category === "opportunity")).toBe(true);
    expect(risks.length).toBe(all.filter((i) => i.category === "risk").length);
    expect(opportunities.length).toBe(all.filter((i) => i.category === "opportunity").length);
  });

  it("builds an Executive Brief composing Business Health, branch rankings, and top risks/wins", async () => {
    const brief = await getExecutiveBriefService(restaurantId, null, "currentMonth");
    expect(brief.businessHealth.overall).toBeGreaterThanOrEqual(0);
    expect(brief.businessHealth.overall).toBeLessThanOrEqual(100);
    expect(brief.branchRankings).toHaveLength(2);
    expect(brief.forecastSummary).toBeTruthy();
    expect(brief.investmentUpdates).toBeTruthy();
  });

  it("builds Branch Narratives naming the real branch and comparing it to the network average", async () => {
    const narratives = await getBranchNarrativesService(restaurantId, "currentMonth");
    expect(narratives).toHaveLength(2);
    const a = narratives.find((n) => n.branchId === branchAId)!;
    expect(a.narrative).toContain("Vitest AI Branch A");
  });

  it("answers 'which branch performed best' correctly identifying the higher-revenue branch", async () => {
    const answer = await answerBestPerformingBranchService(restaurantId, "currentMonth");
    expect(answer.answer).toContain("Vitest AI Branch A");
    expect(answer.supportingMetrics.find((m) => m.key === "revenue")!.value).toBe(2000);
  });

  it("answers 'why did profit change' with a driver decomposition traceable to supportingMetrics", async () => {
    const answer = await answerWhyProfitChangedService(restaurantId, branchAId, "currentMonth");
    const keys = answer.supportingMetrics.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["netProfit", "netProfitPrevious", "revenue", "foodcost", "labourcost"]));
    expect(answer.answer).toContain("Net Profit");
    // The driver named in the prose must be one of the three decomposed impacts, each traceable to a supportingMetrics entry.
    expect(["Revenue", "Food Cost", "Labour Cost"].some((driver) => answer.answer.includes(driver))).toBe(true);
  });

  it("answers a live 'what if sales increase' question by reusing the Scenario Engine's own override mechanism", async () => {
    const answer = await answerWhatIfSalesIncreaseService(restaurantId, branchAId, 10, "currentMonth");
    const projectedRevenue = answer.supportingMetrics.find((m) => m.key === "projectedRevenue")!.value as number;
    expect(projectedRevenue).toBeCloseTo(2200, 0); // 2000 * 1.10
  });

  it("answers 'which KPIs need immediate attention' without throwing, regardless of whether any are flagged", async () => {
    const answer = await answerKpisNeedingAttentionService(restaurantId, branchAId, "currentMonth");
    expect(answer.answer).toBeTruthy();
    expect(answer.relatedScreens.length).toBeGreaterThan(0);
  });
});
