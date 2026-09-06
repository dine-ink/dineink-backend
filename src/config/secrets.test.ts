import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { inspectSecrets, assertSecretsConfigured } from "./secrets";

/**
 * Secret configuration.
 *
 * The failure this guards against is quiet: a production deploy that starts,
 * passes its health check, and signs internal tokens with the same key as
 * restaurant tokens — or with the word "changeme". Nothing surfaces until
 * someone looks, which is usually after it matters.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL };
  // The signing-secret tests below are about signing secrets. Mail is
  // configured here so they aren't also asserting on it; the tests that care
  // about mail delete these explicitly.
  process.env.SENDGRID_API_KEY = "SG.test-key";
  process.env.SENDGRID_FROM_EMAIL = "no-reply@example.test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const strong = () => "k".repeat(48);

describe("secret inspection", () => {
  it("accepts a long, non-placeholder secret", () => {
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = strong();
    expect(inspectSecrets().filter((c) => c.problem)).toHaveLength(0);
  });

  it("reports a missing secret", () => {
    delete process.env.JWT_SECRET;
    delete process.env.INTERNAL_JWT_SECRET;
    const problems = inspectSecrets().filter((c) => c.problem);
    expect(problems.map((c) => c.key).sort()).toEqual(["INTERNAL_JWT_SECRET", "JWT_SECRET"]);
    expect(problems[0].problem).toMatch(/not set/);
  });

  it("rejects a secret short enough to brute-force offline", () => {
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = "short";
    const problem = inspectSecrets().find((c) => c.key === "INTERNAL_JWT_SECRET");
    expect(problem?.problem).toMatch(/at least 32/);
  });

  it("rejects obvious placeholders however long they are", () => {
    // A 48-character "changeme-changeme-…" passes a length check and is still
    // the value nobody replaced.
    for (const placeholder of ["changeme", "placeholder", "your-secret", "dev-secret", "xxxxxxxx"]) {
      process.env.JWT_SECRET = strong();
      process.env.INTERNAL_JWT_SECRET = placeholder;
      const problem = inspectSecrets().find((c) => c.key === "INTERNAL_JWT_SECRET");
      expect(problem?.problem, `${placeholder} should be rejected`).toMatch(/placeholder/);
    }
  });

  it("never puts a secret's value in the check result", () => {
    process.env.JWT_SECRET = "super-secret-value-nobody-should-ever-log-abcdef";
    process.env.INTERNAL_JWT_SECRET = "short";
    const serialised = JSON.stringify(inspectSecrets());
    expect(serialised).not.toContain("super-secret-value");
  });
});

describe("startup enforcement", () => {
  it("exits in production when a secret is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.INTERNAL_JWT_SECRET;
    process.env.JWT_SECRET = strong();

    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => assertSecretsConfigured()).toThrow("process.exit called");
    expect(exit).toHaveBeenCalledWith(1);
    // The operator needs to be told how to fix it, not just that it broke.
    expect(error.mock.calls[0][0]).toMatch(/openssl rand/);
  });

  it("exits in production when a secret is a placeholder", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = "changeme";

    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => assertSecretsConfigured()).toThrow("process.exit called");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("warns but starts outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.INTERNAL_JWT_SECRET;
    delete process.env.JWT_SECRET;

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => assertSecretsConfigured()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("stays silent when everything is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = `${strong()}-distinct`;

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertSecretsConfigured();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

/**
 * The live failure this was added for: a production deploy with no SendGrid
 * configuration started, went green, and the first anyone knew of it was an
 * owner getting "Email service is not configured" partway through creating an
 * account.
 */
describe("mail configuration", () => {
  it("reports missing SendGrid settings as a problem", () => {
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = `${strong()}-distinct`;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;

    const problems = inspectSecrets().filter((c) => c.problem);
    expect(problems.map((c) => c.key).sort()).toEqual([
      "SENDGRID_API_KEY",
      "SENDGRID_FROM_EMAIL",
    ]);
    expect(problems.every((c) => c.severity === "degraded")).toBe(true);
    expect(problems[0].impact).toMatch(/password-reset/);
  });

  it("treats a whitespace-only value as missing", () => {
    // Passes a truthiness check, then fails inside SendGrid with an opaque
    // error — the most annoying way to be misconfigured.
    process.env.SENDGRID_API_KEY = "   ";
    const problem = inspectSecrets().find((c) => c.key === "SENDGRID_API_KEY");
    expect(problem?.problem).toMatch(/not set/);
  });

  it("warns in production but still starts — signup being broken must not take the API down", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = strong();
    process.env.INTERNAL_JWT_SECRET = `${strong()}-distinct`;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    assertSecretsConfigured();

    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    // The warning has to name the variable and what it breaks, or it is just
    // noise in a deploy log nobody reads.
    const message = warn.mock.calls.flat().join(" ");
    expect(message).toContain("SENDGRID_API_KEY");
    expect(message).toMatch(/signup verification/);
  });

  it("still refuses to start when a signing secret is missing, mail or not", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    assertSecretsConfigured();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
