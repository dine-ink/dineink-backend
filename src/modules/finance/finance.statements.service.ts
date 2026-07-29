// Financial Statement generators — Daily/Monthly/Quarterly/Yearly P&L,
// Income Statement, Expense Statement, Food Cost/Labour/Utility Reports, and
// Branch/Restaurant Financial Summaries. Every number in every statement
// comes from computePeriodMetrics/computeFinancialMetrics (finance.formulas.ts)
// or a direct aggregation of the same raw data those functions use — no
// statement here re-derives EBITDA, Prime Cost, etc. independently.
import prisma from "../../config/prisma";
import { resolveDateRange, daysInRange, PeriodKey } from "../../utils/dateRange";
import { recipeCostOf } from "../analytics/analyticsAdvanced.service";
import { getBranchComparisonService } from "../analytics/branchComparison.service";
import { getExpensesReportService } from "../reports/reports.service";
import { computePeriodMetrics, prorateMonthly } from "./finance.service";
import { FinancialMetrics } from "./finance.types";
import { Statement, StatementRow, StatementSection, StatementType } from "./finance.statements.types";

// Local calendar date (YYYY-MM-DD), NOT d.toISOString().slice(0, 10) — that
// converts to UTC first, which silently shifts the date backward by one day
// whenever the server runs in a timezone ahead of UTC (this one runs in
// IST/UTC+5:30). resolveDateRange's boundaries are local-midnight Date
// objects, so recovering the calendar date must also stay in local time,
// or a "currentMonth" range fed back into getExpensesReportService/
// getBranchComparisonService (which re-parse these strings as UTC
// midnight) ends up one day short at each end.
const fmtDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const total = (label: string, value: number): StatementRow => ({ label, value, unit: "currency", isTotal: true });
const row = (label: string, value: number, unit: StatementRow["unit"] = "currency"): StatementRow => ({ label, value, unit });

/**
 * Pure — turns already-computed FinancialMetrics into P&L sections. Split
 * out from buildPnl so it's unit-testable without a database (see
 * finance.statements.test.ts); buildPnl itself just fetches the metrics and
 * hands them here.
 */
export const buildPnlSections = (m: FinancialMetrics): StatementSection[] => [
  { title: "Revenue", rows: [total("Net Revenue", m.revenue)] },
  {
    title: "Cost of Goods Sold",
    rows: [row("Food Cost", m.foodCost), total("Gross Profit", m.grossProfit), row("Gross Margin %", m.grossProfitMarginPercentage, "percentage")],
  },
  {
    title: "Operating Expenses",
    rows: [
      row("Labour Cost", m.labourCost),
      row("Fixed Expenses", m.fixedExpenses),
      row("Variable Expenses", m.variableExpenses),
      total("Total Operating Expenses", m.labourCost + m.fixedExpenses + m.variableExpenses),
    ],
  },
  { title: "EBITDA", rows: [total("EBITDA", m.ebitda), row("EBITDA %", m.ebitdaPercentage, "percentage")] },
  { title: "Finance Cost", rows: [row("Finance Cost", m.financeCost)] },
  { title: "Net Result", rows: [total("Net Profit", m.netProfit), row("Net Profit Margin %", m.netProfitMarginPercentage, "percentage")] },
];

const buildPnl = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const insights = await prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  const m = await computePeriodMetrics(restaurantId, branchId, range, insights);

  return {
    type: "pnl",
    title: "Profit & Loss Statement",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: buildPnlSections(m),
  };
};

const buildIncomeStatement = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const insights = await prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  const [m, revenueByType] = await Promise.all([
    computePeriodMetrics(restaurantId, branchId, range, insights),
    prisma.bill.groupBy({
      by: ["orderType"],
      where: { restaurantId, branchId, status: "PAID", createdAt: { gte: range.startDate, lte: range.endDate } },
      _sum: { total: true },
    }),
  ]);

  return {
    type: "income",
    title: "Income Statement",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: [
      {
        title: "Revenue by Channel",
        rows: [
          ...revenueByType.map((r) => row(r.orderType.replace(/_/g, " "), r._sum.total || 0)),
          total("Total Revenue", m.revenue),
        ],
      },
      { title: "Expenses", rows: [row("Food Cost", m.foodCost), row("Labour Cost", m.labourCost), row("Fixed Expenses", m.fixedExpenses), row("Variable Expenses", m.variableExpenses), row("Finance Cost", m.financeCost), total("Total Expenses", m.totalExpenses)] },
      { title: "Result", rows: [total("Net Profit", m.netProfit), row("Net Profit Margin %", m.netProfitMarginPercentage, "percentage")] },
    ],
  };
};

const buildExpenseStatement = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const expenses = await getExpensesReportService(branchId, fmtDate(range.startDate), fmtDate(range.endDate));
  const byType = new Map<string, number>();
  for (const e of expenses) {
    const key = e.expenseType || "Other";
    byType.set(key, (byType.get(key) || 0) + Number(e.amount || 0));
  }
  const totalExp = [...byType.values()].reduce((s, v) => s + v, 0);

  return {
    type: "expense",
    title: "Expense Statement",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: [
      {
        title: "Expenses by Category",
        rows: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => row(label, value)),
      },
      { title: "Total", rows: [total("Total Expenses", totalExp)] },
    ],
  };
};

const buildFoodCostReport = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const insights = await prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  const [m, menuItems, soldQuantities] = await Promise.all([
    computePeriodMetrics(restaurantId, branchId, range, insights),
    prisma.menuItem.findMany({
      where: { restaurantId, isDeleted: false },
      select: { id: true, name: true, menuItemIngredients: { select: { quantity: true, unit: true, ingredient: { select: { pricePerUnit: true, unit: true } } } } },
    }),
    prisma.billItem.groupBy({
      by: ["menuItemId"],
      where: { menuItemId: { not: null }, bill: { restaurantId, branchId, status: "PAID", createdAt: { gte: range.startDate, lte: range.endDate } } },
      _sum: { quantity: true },
    }),
  ]);

  const nameById = new Map(menuItems.map((mi) => [mi.id, mi.name]));
  const costById = new Map(menuItems.map((mi) => [mi.id, recipeCostOf(mi)]));
  const topItems = soldQuantities
    .filter((r) => r.menuItemId !== null)
    .map((r) => ({
      name: nameById.get(r.menuItemId as number) || "Unknown",
      cost: (costById.get(r.menuItemId as number) || 0) * (r._sum.quantity || 0),
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  return {
    type: "foodCost",
    title: "Food Cost Report",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}${insights?.manualFoodCost ? " (manual override)" : ""}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: [
      { title: "Summary", rows: [total("Food Cost", m.foodCost), row("Food Cost %", m.foodCostPercentage, "percentage"), row("Revenue", m.revenue)] },
      { title: "Top 10 Ingredient-Cost Items", rows: topItems.map((i) => row(i.name, Math.round(i.cost))) },
    ],
  };
};

const buildLabourReport = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const insights = await prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  const [m, staff] = await Promise.all([
    computePeriodMetrics(restaurantId, branchId, range, insights),
    prisma.user.findMany({ where: { restaurantId, branchId, isDeleted: false }, select: { name: true, role: true, salary: true } }),
  ]);
  const staffCount = staff.length;
  const avgSalary = staffCount > 0 ? Math.round(staff.reduce((s, u) => s + (u.salary || 0), 0) / staffCount) : 0;

  return {
    type: "labour",
    title: "Labour Report",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: [
      { title: "Summary", rows: [total("Labour Cost", m.labourCost), row("Labour Cost %", m.labourCostPercentage, "percentage"), row("Staff Count", staffCount, "count"), row("Average Monthly Salary", avgSalary)] },
      { title: "Staff", rows: staff.map((u) => row(`${u.name} (${u.role})`, u.salary || 0)) },
    ],
  };
};

const buildUtilityReport = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const insights = await prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  const m = await computePeriodMetrics(restaurantId, branchId, range, insights);
  const daysFactor = daysInRange(range);
  const electricity = prorateMonthly(insights?.electricity, daysFactor);
  const gas = prorateMonthly(insights?.gas, daysFactor);
  const utilities = electricity + gas;
  const utilityPercentage = m.revenue > 0 ? Math.round((utilities / m.revenue) * 1000) / 10 : 0;

  return {
    type: "utility",
    title: "Utility Report",
    subtitle: `${fmtDate(range.startDate)} to ${fmtDate(range.endDate)}`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: [
      { title: "Summary", rows: [row("Electricity", electricity), row("Gas", gas), total("Total Utilities", utilities), row("Utility %", utilityPercentage, "percentage")] },
    ],
  };
};

const branchRowsFrom = (b: any) => [
  row("Revenue", b.revenue),
  row("Food Cost", b.foodCost),
  row("Food Cost %", b.foodCostPercentage, "percentage"),
  row("Labour Cost", b.labourCost),
  row("Labour Cost %", b.labourCostPercentage, "percentage"),
  row("Prime Cost", b.primeCost),
  row("Prime Cost %", b.primeCostPercentage, "percentage"),
  row("Expenses", b.expenses),
  total("Net Profit", b.netProfit),
  row("Staff Count", b.staffCount, "count"),
];

const buildBranchSummary = async (restaurantId: number, branchId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const branches = await getBranchComparisonService(restaurantId, fmtDate(range.startDate), fmtDate(range.endDate));
  const branch = branches.find((b: any) => b.branch.id === branchId);

  return {
    type: "branchSummary",
    title: "Branch Financial Summary",
    subtitle: branch ? branch.branch.name : "Branch not found",
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId,
    sections: branch ? [{ title: branch.branch.name, rows: branchRowsFrom(branch) }] : [],
  };
};

const buildRestaurantSummary = async (restaurantId: number, period: PeriodKey, from?: string, to?: string): Promise<Statement> => {
  const range = resolveDateRange(period, from, to);
  const branches = await getBranchComparisonService(restaurantId, fmtDate(range.startDate), fmtDate(range.endDate));

  const consolidated = branches.reduce(
    (acc: any, b: any) => ({
      revenue: acc.revenue + b.revenue,
      foodCost: acc.foodCost + b.foodCost,
      labourCost: acc.labourCost + b.labourCost,
      expenses: acc.expenses + b.expenses,
      netProfit: acc.netProfit + b.netProfit,
      staffCount: acc.staffCount + b.staffCount,
    }),
    { revenue: 0, foodCost: 0, labourCost: 0, expenses: 0, netProfit: 0, staffCount: 0 },
  );
  const foodCostPercentage = consolidated.revenue > 0 ? Math.round((consolidated.foodCost / consolidated.revenue) * 1000) / 10 : 0;
  const labourCostPercentage = consolidated.revenue > 0 ? Math.round((consolidated.labourCost / consolidated.revenue) * 1000) / 10 : 0;

  return {
    type: "restaurantSummary",
    title: "Restaurant Financial Summary",
    subtitle: `${branches.length} branch(es) consolidated`,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    restaurantId,
    branchId: null,
    sections: [
      {
        title: "Consolidated",
        rows: [
          total("Revenue", consolidated.revenue),
          row("Food Cost", consolidated.foodCost),
          row("Food Cost %", foodCostPercentage, "percentage"),
          row("Labour Cost", consolidated.labourCost),
          row("Labour Cost %", labourCostPercentage, "percentage"),
          row("Expenses", consolidated.expenses),
          total("Net Profit", consolidated.netProfit),
          row("Total Staff", consolidated.staffCount, "count"),
        ],
      },
      {
        title: "By Branch",
        rows: branches.map((b: any) => row(b.branch.name, b.netProfit)),
      },
    ],
  };
};

export const getStatementService = async (
  type: StatementType,
  restaurantId: number,
  branchId: number,
  period: PeriodKey,
  from?: string,
  to?: string,
) => {
  switch (type) {
    case "pnl":
      return buildPnl(restaurantId, branchId, period, from, to);
    case "income":
      return buildIncomeStatement(restaurantId, branchId, period, from, to);
    case "expense":
      return buildExpenseStatement(restaurantId, branchId, period, from, to);
    case "foodCost":
      return buildFoodCostReport(restaurantId, branchId, period, from, to);
    case "labour":
      return buildLabourReport(restaurantId, branchId, period, from, to);
    case "utility":
      return buildUtilityReport(restaurantId, branchId, period, from, to);
    case "branchSummary":
      return buildBranchSummary(restaurantId, branchId, period, from, to);
    case "restaurantSummary":
      return buildRestaurantSummary(restaurantId, period, from, to);
    default:
      throw new Error(`Unknown statement type: ${type}`);
  }
};
