export type BudgetCategoryUnit = "currency" | "percentage" | "count";

export interface BudgetCategoryDef {
  key: string;
  label: string;
  unit: BudgetCategoryUnit;
  /** true = a higher actual is the good outcome (Revenue, EBITDA); false = lower is better (Food Cost, Labour). Governs achievement % direction, same convention as the Ratio Engine. */
  higherIsBetter: boolean;
  /** Whether an actual value can currently be resolved from the Finance Engine. false for categories with no tracked source yet (Cleaning, Cash Flow) — budgets can still be set, but variance/actual show as unavailable rather than a fabricated number. */
  actualAvailable: boolean;
  /** true = a contracted/scheduled cost (Rent, Labour, EMI, Insurance, ...) whose planned value is auto-derived from RestaurantInsights/live payroll rather than typed in fresh each time — see getFixedCostDefaultsService. false = a genuinely variable cost the owner plans manually. */
  isFixed: boolean;
}

// Every category the finance engine (or a direct, already-established
// proration of RestaurantInsights) can resolve an actual for. Extending this
// list is the ONLY step needed to budget a new category — no other file
// needs to change unless the new category also needs a new actual-resolver
// case in budget.service.ts's `actualFor`.
export const BUDGET_CATEGORIES: BudgetCategoryDef[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, actualAvailable: true, isFixed: false },
  { key: "orders", label: "Orders", unit: "count", higherIsBetter: true, actualAvailable: true, isFixed: false },
  { key: "avgOrderValue", label: "Average Order Value", unit: "currency", higherIsBetter: true, actualAvailable: true, isFixed: false },
  { key: "foodCost", label: "Food Cost", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "primeCost", label: "Prime Cost", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "labour", label: "Labour", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "labourPercentage", label: "Labour %", unit: "percentage", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "rent", label: "Rent", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "loanEmi", label: "Loan EMI", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "internet", label: "Internet", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "phoneBills", label: "Phone Bills", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "accounting", label: "Accounting Fees", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "insurance", label: "Insurance", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "licenses", label: "Licenses & Permits", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: true },
  { key: "utilities", label: "Utilities", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "marketing", label: "Marketing", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "maintenance", label: "Maintenance", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "cleaning", label: "Cleaning", unit: "currency", higherIsBetter: false, actualAvailable: false, isFixed: false },
  { key: "packaging", label: "Packaging", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "deliveryCommission", label: "Delivery Commission", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "operatingExpenses", label: "Operating Expenses", unit: "currency", higherIsBetter: false, actualAvailable: true, isFixed: false },
  { key: "ebitda", label: "EBITDA", unit: "currency", higherIsBetter: true, actualAvailable: true, isFixed: false },
  { key: "netProfit", label: "Net Profit", unit: "currency", higherIsBetter: true, actualAvailable: true, isFixed: false },
  { key: "cashFlow", label: "Cash Flow", unit: "currency", higherIsBetter: true, actualAvailable: false, isFixed: false },
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
  isFixed: boolean;
  budget: number | null;
  actual: number | null;
  variance: number | null;
  variancePercentage: number | null;
  achievementPercentage: number | null;
  status: BudgetVarianceStatus;
  trendDirection: "up" | "down" | "flat" | null;
}

export interface FixedCostDefaults {
  rent: number;
  labour: number;
  loanEmi: number;
  internet: number;
  phoneBills: number;
  accounting: number;
  insurance: number;
  licenses: number;
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
