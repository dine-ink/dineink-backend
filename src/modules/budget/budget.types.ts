export type BudgetCategoryUnit = "currency" | "percentage" | "count";

export interface BudgetCategoryDef {
  key: string;
  label: string;
  unit: BudgetCategoryUnit;
  /** true = a higher actual is the good outcome (Revenue, EBITDA); false = lower is better (Food Cost, Labour). Governs achievement % direction, same convention as the Ratio Engine. */
  higherIsBetter: boolean;
  /** Whether an actual value can currently be resolved from the Finance Engine. false for categories with no tracked source yet (Cleaning, Cash Flow) — budgets can still be set, but variance/actual show as unavailable rather than a fabricated number. */
  actualAvailable: boolean;
}

// Every category the finance engine (or a direct, already-established
// proration of RestaurantInsights) can resolve an actual for. Extending this
// list is the ONLY step needed to budget a new category — no other file
// needs to change unless the new category also needs a new actual-resolver
// case in budget.service.ts's `actualFor`.
export const BUDGET_CATEGORIES: BudgetCategoryDef[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, actualAvailable: true },
  { key: "orders", label: "Orders", unit: "count", higherIsBetter: true, actualAvailable: true },
  { key: "avgOrderValue", label: "Average Order Value", unit: "currency", higherIsBetter: true, actualAvailable: true },
  { key: "foodCost", label: "Food Cost", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", higherIsBetter: false, actualAvailable: true },
  { key: "primeCost", label: "Prime Cost", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "labour", label: "Labour", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "labourPercentage", label: "Labour %", unit: "percentage", higherIsBetter: false, actualAvailable: true },
  { key: "rent", label: "Rent", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "utilities", label: "Utilities", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "marketing", label: "Marketing", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "maintenance", label: "Maintenance", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "cleaning", label: "Cleaning", unit: "currency", higherIsBetter: false, actualAvailable: false },
  { key: "packaging", label: "Packaging", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "deliveryCommission", label: "Delivery Commission", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "operatingExpenses", label: "Operating Expenses", unit: "currency", higherIsBetter: false, actualAvailable: true },
  { key: "ebitda", label: "EBITDA", unit: "currency", higherIsBetter: true, actualAvailable: true },
  { key: "netProfit", label: "Net Profit", unit: "currency", higherIsBetter: true, actualAvailable: true },
  { key: "cashFlow", label: "Cash Flow", unit: "currency", higherIsBetter: true, actualAvailable: false },
];

export const BUDGET_CATEGORY_KEYS = BUDGET_CATEGORIES.map((c) => c.key);
export const BUDGET_CATEGORY_MAP = new Map(BUDGET_CATEGORIES.map((c) => [c.key, c]));

export type BudgetStatusValue = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface BudgetItemInput {
  category: string;
  year: number;
  month: number; // 1-12
  amount: number;
  notes?: string | null;
}

export type BudgetVarianceStatus = "on-track" | "warning" | "critical" | "no-data";

export interface BudgetVarianceRow {
  category: string;
  label: string;
  unit: BudgetCategoryUnit;
  budget: number | null;
  actual: number | null;
  variance: number | null;
  variancePercentage: number | null;
  achievementPercentage: number | null;
  status: BudgetVarianceStatus;
  trendDirection: "up" | "down" | "flat" | null;
}

export interface BudgetVarianceReport {
  budgetId: number;
  restaurantId: number;
  branchId: number | null;
  period: string;
  startDate: string;
  endDate: string;
  rows: BudgetVarianceRow[];
}
