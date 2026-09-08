import { describe, expect, it } from "vitest";
import { backoffFor } from "./queue";

/**
 * Queue behaviour that is pure and therefore testable without a database.
 *
 * The claiming logic — `FOR UPDATE SKIP LOCKED` — is exercised against a real
 * Postgres in the integration check rather than here, because a mock cannot
 * demonstrate the property that matters (two workers not taking the same row).
 */

describe("retry backoff", () => {
  it("grows exponentially so a struggling integration is not hammered", () => {
    const first = backoffFor(1).getTime() - Date.now();
    const second = backoffFor(2).getTime() - Date.now();
    const third = backoffFor(3).getTime() - Date.now();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("starts soon enough that a transient blip clears unnoticed", () => {
    const delayMs = backoffFor(1).getTime() - Date.now();
    // ~30 seconds, with slack for the clock ticking between the two calls.
    expect(delayMs).toBeGreaterThan(25_000);
    expect(delayMs).toBeLessThan(35_000);
  });

  it("caps so a long-broken job does not drift to never", () => {
    // Without a ceiling, attempt 10 would be scheduled years out and the job
    // would look pending forever rather than surfacing as dead.
    const far = backoffFor(20).getTime() - Date.now();
    expect(far).toBeLessThanOrEqual(3600 * 1000 + 1000);
  });
});
