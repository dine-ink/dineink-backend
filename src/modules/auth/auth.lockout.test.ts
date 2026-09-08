import { describe, expect, it } from "vitest";
import {
  FAILURE_WINDOW_MINUTES,
  MAX_FAILED_ATTEMPTS,
  attemptsRemaining,
  failureWindowStart,
  shouldLock,
} from "./auth.lockout";

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

describe("shouldLock — 20 failures inside the window latches the account", () => {
  it("does not lock below the limit", () => {
    expect(shouldLock(0)).toBe(false);
    expect(shouldLock(1)).toBe(false);
    expect(shouldLock(MAX_FAILED_ATTEMPTS - 1)).toBe(false);
  });

  it("locks exactly on the 20th failure, not the 21st", () => {
    expect(shouldLock(MAX_FAILED_ATTEMPTS)).toBe(true);
  });

  it("stays locked for counts beyond the limit", () => {
    expect(shouldLock(MAX_FAILED_ATTEMPTS + 50)).toBe(true);
  });

  it("uses the limit the product asked for", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(20);
    expect(FAILURE_WINDOW_MINUTES).toBe(60);
  });
});

describe("attemptsRemaining — what the caller has left", () => {
  it("counts down from the limit", () => {
    expect(attemptsRemaining(0)).toBe(20);
    expect(attemptsRemaining(19)).toBe(1);
  });

  it("never reports a negative number of remaining attempts", () => {
    expect(attemptsRemaining(20)).toBe(0);
    expect(attemptsRemaining(99)).toBe(0);
  });
});

describe("failureWindowStart — which failures still count", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("counts from one hour ago when the password has never been changed", () => {
    expect(failureWindowStart(now, null)).toEqual(minutesAgo(now, 60));
  });

  it("counts from one hour ago when the last password change is older than that", () => {
    const changedLastWeek = minutesAgo(now, 60 * 24 * 7);
    expect(failureWindowStart(now, changedLastWeek)).toEqual(minutesAgo(now, 60));
  });

  it("counts from the password change when it is more recent than the window", () => {
    // The case that matters: a user locked out at 11:30 resets their password
    // at 11:55. The 20 failures behind them are still inside the last hour, so
    // without this the very next sign-in would re-lock the account.
    const justReset = minutesAgo(now, 5);
    expect(failureWindowStart(now, justReset)).toEqual(justReset);
  });

  it("treats a password change in the same instant as the boundary", () => {
    expect(failureWindowStart(now, now)).toEqual(now);
  });

  it("ignores undefined the same way it ignores null", () => {
    expect(failureWindowStart(now, undefined)).toEqual(minutesAgo(now, 60));
  });
});
