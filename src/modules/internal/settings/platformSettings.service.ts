import prisma from "../../../config/prisma";

/**
 * Platform configuration, read through a short-lived cache.
 *
 * Settings are consulted on nearly every dashboard and restaurant-list request
 * (activity thresholds, commission rate), so reading them from the database each
 * time would add a query to every page load for values that change perhaps once
 * a month. Thirty seconds is short enough that a change made in the settings
 * screen is visible almost immediately and long enough to take the load off.
 */

const CACHE_TTL_MS = 30_000;

let cache: { at: number; values: Map<string, unknown> } | null = null;

export const invalidateSettingsCache = () => {
  cache = null;
};

const loadAll = async (): Promise<Map<string, unknown>> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;
  const rows = await prisma.platformSetting.findMany();
  const values = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));
  cache = { at: Date.now(), values };
  return values;
};

export const SETTING_KEYS = {
  COMPANY_NAME: "company.name",
  COMPANY_SUPPORT_EMAIL: "company.supportEmail",
  COMPANY_SUPPORT_PHONE: "company.supportPhone",
  COMMISSION_PERCENT: "payments.commissionPercent",
  SETTLEMENT_CYCLE_DAYS: "payments.settlementCycleDays",
  INACTIVE_RESTAURANT_DAYS: "business.inactiveRestaurantDays",
  AT_RISK_RESTAURANT_DAYS: "business.atRiskRestaurantDays",
  SESSION_TIMEOUT_HOURS: "security.sessionTimeoutHours",
  REQUIRE_2FA_PRIVILEGED: "security.require2faForPrivilegedRoles",
} as const;

export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const values = await loadAll();
  const value = values.get(key);
  return value === undefined || value === null ? fallback : (value as T);
};

export const getNumberSetting = async (key: string, fallback: number): Promise<number> => {
  const value = await getSetting<unknown>(key, fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * The commission rate, or null when nobody has configured one.
 *
 * The null case is load-bearing and must be preserved by every caller: Dine
 * Inc.'s revenue share isn't represented anywhere in the restaurant schema, so
 * there is no correct default. Callers show "not configured" rather than
 * multiplying GMV by a number somebody guessed.
 */
export const getCommissionPercent = async (): Promise<number | null> => {
  const values = await loadAll();
  const value = values.get(SETTING_KEYS.COMMISSION_PERCENT);
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export interface ActivityThresholds {
  inactiveDays: number;
  atRiskDays: number;
}

export const getActivityThresholds = async (): Promise<ActivityThresholds> => ({
  inactiveDays: await getNumberSetting(SETTING_KEYS.INACTIVE_RESTAURANT_DAYS, 3),
  atRiskDays: await getNumberSetting(SETTING_KEYS.AT_RISK_RESTAURANT_DAYS, 7),
});

export type ActivityClass = "ACTIVE" | "LOW_ACTIVITY" | "INACTIVE" | "AT_RISK";

/**
 * How a restaurant's trading activity is described in lists and analytics.
 *
 * A restaurant that has never traded is NOT "at risk" — it is a new record that
 * hasn't started yet, and conflating the two would fill the operations team's
 * at-risk queue with restaurants still being onboarded.
 */
export const classifyActivity = (
  lastActivityAt: Date | null | undefined,
  thresholds: ActivityThresholds,
  platformStatus?: string,
): ActivityClass => {
  if (!lastActivityAt) return platformStatus === "ACTIVE" ? "INACTIVE" : "LOW_ACTIVITY";
  const days = (Date.now() - lastActivityAt.getTime()) / 86_400_000;
  if (days <= 1) return "ACTIVE";
  if (days <= thresholds.inactiveDays) return "LOW_ACTIVITY";
  if (days <= thresholds.atRiskDays) return "AT_RISK";
  return "INACTIVE";
};
