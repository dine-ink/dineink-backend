// Calendar-aware period resolution for financial reporting. Deliberately
// separate from analytics.service.ts's own getDateRange (rolling-window only,
// used by the existing dashboard/kitchen/heatmap endpoints) — changing that
// one's semantics would silently change what "quarter" means for screens
// already relying on it. This is the richer version, used by the finance
// module (and anything else built after it) for real calendar periods plus
// the "previous period" needed for variance/trend.

export type PeriodKey =
  | "today"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "last90days"
  | "currentWeek"
  | "previousWeek"
  | "currentMonth"
  | "previousMonth"
  | "currentQuarter"
  | "previousQuarter"
  | "currentYear"
  | "previousYear"
  | "rolling12Months"
  | "custom";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// Exported (in addition to being used internally below) so other modules
// that need to build date ranges outside what resolveDateRange itself covers
// — e.g. the Forecast Engine's "next week/month/quarter/year" resolution,
// which has no "current/previous" equivalent here — can reuse the exact same
// calendar-boundary logic instead of re-deriving it.
export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

// Monday-start week, matching Indian business-week convention.
export const startOfWeek = (d: Date): Date => {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
};

export const endOfWeek = (d: Date): Date => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
};

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d: Date): Date => endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));

export const startOfQuarter = (d: Date): Date => {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
};
export const endOfQuarter = (d: Date): Date => {
  const s = startOfQuarter(d);
  return endOfDay(new Date(s.getFullYear(), s.getMonth() + 3, 0));
};

export const startOfYear = (d: Date): Date => new Date(d.getFullYear(), 0, 1);
export const endOfYear = (d: Date): Date => endOfDay(new Date(d.getFullYear(), 11, 31));

/**
 * Resolves a period key (or an explicit from/to) into a concrete date range.
 * `from`/`to` (ISO date strings) always win when both are supplied,
 * regardless of `period` — matching the existing convention elsewhere in
 * this backend.
 */
export const resolveDateRange = (
  period: PeriodKey,
  from?: string,
  to?: string,
): DateRange => {
  if (from && to) {
    return { startDate: startOfDay(new Date(from)), endDate: endOfDay(new Date(to)) };
  }

  const now = new Date();

  switch (period) {
    case "today":
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { startDate: startOfDay(y), endDate: endOfDay(y) };
    }
    case "last7days": {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { startDate: startOfDay(s), endDate: endOfDay(now) };
    }
    case "last30days": {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { startDate: startOfDay(s), endDate: endOfDay(now) };
    }
    case "last90days": {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return { startDate: startOfDay(s), endDate: endOfDay(now) };
    }
    case "currentWeek":
      return { startDate: startOfWeek(now), endDate: endOfWeek(now) };
    case "previousWeek": {
      const pw = new Date(now);
      pw.setDate(pw.getDate() - 7);
      return { startDate: startOfWeek(pw), endDate: endOfWeek(pw) };
    }
    case "currentMonth":
      return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
    case "previousMonth": {
      const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { startDate: startOfMonth(pm), endDate: endOfMonth(pm) };
    }
    case "currentQuarter":
      return { startDate: startOfQuarter(now), endDate: endOfQuarter(now) };
    case "previousQuarter": {
      const s = startOfQuarter(now);
      const pq = new Date(s.getFullYear(), s.getMonth() - 3, 1);
      return { startDate: startOfQuarter(pq), endDate: endOfQuarter(pq) };
    }
    case "currentYear":
      return { startDate: startOfYear(now), endDate: endOfYear(now) };
    case "previousYear": {
      const py = new Date(now.getFullYear() - 1, 0, 1);
      return { startDate: startOfYear(py), endDate: endOfYear(py) };
    }
    case "rolling12Months": {
      const s = new Date(now);
      s.setMonth(s.getMonth() - 11);
      return { startDate: startOfMonth(s), endDate: endOfDay(now) };
    }
    case "custom":
    default:
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
  }
};

/**
 * The comparison ("previous") period for variance/trend calculations.
 * Calendar-true for week/month/quarter/year (so "this month" compares
 * against the actual preceding calendar month, not just "30 days earlier"),
 * and an equal-length immediately-preceding window for everything else
 * (today/yesterday/rolling windows/custom ranges, which have no natural
 * calendar unit to align to).
 */
export const getComparisonPeriod = (period: PeriodKey, range: DateRange): DateRange => {
  switch (period) {
    case "currentWeek":
    case "previousWeek": {
      const priorAnchor = new Date(range.startDate);
      priorAnchor.setDate(priorAnchor.getDate() - 7);
      return { startDate: startOfWeek(priorAnchor), endDate: endOfWeek(priorAnchor) };
    }
    case "currentMonth":
    case "previousMonth": {
      const priorAnchor = new Date(range.startDate.getFullYear(), range.startDate.getMonth() - 1, 1);
      return { startDate: startOfMonth(priorAnchor), endDate: endOfMonth(priorAnchor) };
    }
    case "currentQuarter":
    case "previousQuarter": {
      const priorAnchor = new Date(range.startDate.getFullYear(), range.startDate.getMonth() - 3, 1);
      return { startDate: startOfQuarter(priorAnchor), endDate: endOfQuarter(priorAnchor) };
    }
    case "currentYear":
    case "previousYear": {
      const priorAnchor = new Date(range.startDate.getFullYear() - 1, 0, 1);
      return { startDate: startOfYear(priorAnchor), endDate: endOfYear(priorAnchor) };
    }
    default: {
      const lengthMs = range.endDate.getTime() - range.startDate.getTime();
      const priorEnd = new Date(range.startDate.getTime() - 1);
      const priorStart = new Date(priorEnd.getTime() - lengthMs);
      return { startDate: startOfDay(priorStart), endDate: endOfDay(priorEnd) };
    }
  }
};

/**
 * Whole calendar days spanned by a range, inclusive — used to prorate
 * monthly assumption figures. Floors both ends to midnight before diffing:
 * every range here has endDate at 23:59:59.999, so diffing the raw
 * timestamps and adding 1 double-counts the partial last day (e.g. "today"
 * — a single calendar day — would come out to 2, not 1).
 */
export const daysInRange = (range: DateRange): number => {
  const startDay = startOfDay(range.startDate);
  const endDay = startOfDay(range.endDate);
  return Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1);
};
