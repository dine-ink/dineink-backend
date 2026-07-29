import { describe, expect, it } from "vitest";
import { daysInRange, getComparisonPeriod, resolveDateRange } from "./dateRange";

describe("resolveDateRange — explicit from/to (always wins over period)", () => {
  it("resolves to the exact requested range, start of day to end of day", () => {
    const range = resolveDateRange("currentMonth", "2026-07-01", "2026-07-31");
    expect(range.startDate.getFullYear()).toBe(2026);
    expect(range.startDate.getMonth()).toBe(6); // July, 0-indexed
    expect(range.startDate.getDate()).toBe(1);
    expect(range.startDate.getHours()).toBe(0);
    expect(range.endDate.getDate()).toBe(31);
    expect(range.endDate.getHours()).toBe(23);
    expect(range.endDate.getMinutes()).toBe(59);
  });

  it("even with period='today', from/to override it", () => {
    const range = resolveDateRange("today", "2026-01-01", "2026-01-05");
    expect(range.startDate.getDate()).toBe(1);
    expect(range.endDate.getDate()).toBe(5);
  });
});

describe("resolveDateRange — calendar period keys", () => {
  it("'today' spans exactly one calendar day", () => {
    const range = resolveDateRange("today");
    expect(range.startDate.toDateString()).toBe(range.endDate.toDateString());
    expect(range.startDate.getHours()).toBe(0);
    expect(range.endDate.getHours()).toBe(23);
  });

  it("'currentMonth' starts on day 1 of the current month", () => {
    const now = new Date();
    const range = resolveDateRange("currentMonth");
    expect(range.startDate.getDate()).toBe(1);
    expect(range.startDate.getMonth()).toBe(now.getMonth());
    expect(range.startDate.getFullYear()).toBe(now.getFullYear());
  });

  it("'currentMonth' ends on the last calendar day of the month", () => {
    const range = resolveDateRange("currentMonth");
    const nextDay = new Date(range.endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    // The day after the range's end should roll into the next month
    expect(nextDay.getMonth()).not.toBe(range.startDate.getMonth());
  });

  it("'currentYear' spans Jan 1 to Dec 31 of the current year", () => {
    const now = new Date();
    const range = resolveDateRange("currentYear");
    expect(range.startDate.getMonth()).toBe(0);
    expect(range.startDate.getDate()).toBe(1);
    expect(range.endDate.getMonth()).toBe(11);
    expect(range.endDate.getDate()).toBe(31);
    expect(range.startDate.getFullYear()).toBe(now.getFullYear());
  });

  it("'previousYear' is exactly one calendar year before 'currentYear'", () => {
    const current = resolveDateRange("currentYear");
    const previous = resolveDateRange("previousYear");
    expect(previous.startDate.getFullYear()).toBe(current.startDate.getFullYear() - 1);
    expect(previous.startDate.getMonth()).toBe(0);
    expect(previous.startDate.getDate()).toBe(1);
  });

  it("'currentQuarter' starts on the first day of a quarter month (Jan/Apr/Jul/Oct)", () => {
    const range = resolveDateRange("currentQuarter");
    expect([0, 3, 6, 9]).toContain(range.startDate.getMonth());
    expect(range.startDate.getDate()).toBe(1);
  });

  it("'currentWeek' is Monday-start (matching Indian business-week convention)", () => {
    const range = resolveDateRange("currentWeek");
    expect(range.startDate.getDay()).toBe(1); // Monday
  });
});

describe("getComparisonPeriod", () => {
  it("'currentMonth' compares against the actual preceding calendar month, not just 30 days earlier", () => {
    const current = resolveDateRange("currentMonth");
    const previous = getComparisonPeriod("currentMonth", current);
    const expectedPrevMonth = (current.startDate.getMonth() + 11) % 12;
    expect(previous.startDate.getMonth()).toBe(expectedPrevMonth);
    expect(previous.startDate.getDate()).toBe(1);
  });

  it("'currentYear' compares against the preceding calendar year", () => {
    const current = resolveDateRange("currentYear");
    const previous = getComparisonPeriod("currentYear", current);
    expect(previous.startDate.getFullYear()).toBe(current.startDate.getFullYear() - 1);
  });

  it("falls back to an equal-length immediately-preceding window for non-calendar periods (e.g. custom/rolling)", () => {
    const current = resolveDateRange("custom", "2026-07-10", "2026-07-19"); // 10-day range
    const previous = getComparisonPeriod("custom", current);
    const previousLengthDays = daysInRange(previous);
    expect(previousLengthDays).toBe(10);
    // Previous range should end the day before current starts
    expect(previous.endDate.getTime()).toBeLessThan(current.startDate.getTime());
  });
});

describe("daysInRange — the off-by-one fix (regression test)", () => {
  it("'today' (a single calendar day) is exactly 1 day, not 2", () => {
    // This is the exact bug found during Tier-1 verification: diffing
    // 23:59:59.999 against 00:00:00.000 of the same day without flooring to
    // midnight rounds the ~0.9999988-day gap up to 1, then +1 = 2.
    const range = resolveDateRange("today");
    expect(daysInRange(range)).toBe(1);
  });

  it("an explicit single-day custom range is exactly 1 day", () => {
    const range = resolveDateRange("custom", "2026-07-15", "2026-07-15");
    expect(daysInRange(range)).toBe(1);
  });

  it("a 31-day calendar month (July) is exactly 31 days", () => {
    const range = resolveDateRange("custom", "2026-07-01", "2026-07-31");
    expect(daysInRange(range)).toBe(31);
  });

  it("a 7-day range (currentWeek) is exactly 7 days", () => {
    const range = resolveDateRange("currentWeek");
    expect(daysInRange(range)).toBe(7);
  });

  it("never returns less than 1, even for a degenerate/inverted range", () => {
    const range = { startDate: new Date("2026-07-10"), endDate: new Date("2026-07-05") };
    expect(daysInRange(range)).toBeGreaterThanOrEqual(1);
  });
});
