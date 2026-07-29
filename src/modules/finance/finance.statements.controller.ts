import { Request, Response } from "express";
import { getStatementService } from "./finance.statements.service";
import { StatementType } from "./finance.statements.types";
import { PeriodKey } from "../../utils/dateRange";

const VALID_TYPES: StatementType[] = [
  "pnl",
  "income",
  "expense",
  "foodCost",
  "labour",
  "utility",
  "branchSummary",
  "restaurantSummary",
];

const VALID_PERIODS: PeriodKey[] = [
  "today",
  "yesterday",
  "last7days",
  "last30days",
  "last90days",
  "currentWeek",
  "previousWeek",
  "currentMonth",
  "previousMonth",
  "currentQuarter",
  "previousQuarter",
  "currentYear",
  "previousYear",
  "rolling12Months",
  "custom",
];

export const getStatement = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const typeParam = req.params.type as string;
    if (!(VALID_TYPES as string[]).includes(typeParam)) {
      return res.status(400).json({ success: false, message: `Invalid statement type. Must be one of: ${VALID_TYPES.join(", ")}` });
    }
    const periodParam = (req.query.period as string) || "currentMonth";
    const period: PeriodKey = (VALID_PERIODS as string[]).includes(periodParam) ? (periodParam as PeriodKey) : "currentMonth";
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const data = await getStatementService(typeParam as StatementType, restaurantId, branchId, period, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.log(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};
