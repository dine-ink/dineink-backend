import { PeriodKey } from "../../utils/dateRange";

export type StatementType =
  | "pnl"
  | "income"
  | "expense"
  | "foodCost"
  | "labour"
  | "utility"
  | "branchSummary"
  | "restaurantSummary";

export interface StatementRow {
  label: string;
  value: number | string;
  unit?: "currency" | "percentage" | "count" | "text";
  isTotal?: boolean;
}

export interface StatementSection {
  title: string;
  rows: StatementRow[];
}

/** A statement is deliberately generic — a title, a period, and a list of
 * labelled sections — so one set of PDF/Excel/CSV/print renderers works for
 * every statement type, on the frontend, instead of a bespoke layout per type. */
export interface Statement {
  type: StatementType;
  title: string;
  subtitle: string;
  period: PeriodKey;
  startDate: string;
  endDate: string;
  restaurantId: number;
  branchId: number | null;
  sections: StatementSection[];
}
