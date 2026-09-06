import prisma from "../../../config/prisma";

/**
 * Platform configuration.
 *
 * Reduced to the two company-identity values the console genuinely reads. What
 * used to live here and no longer does:
 *
 *   payments.commissionPercent      DineInk does not take a share of what a
 *   payments.settlementCycleDays    restaurant sells. It sells software on
 *                                   subscription; there is nothing to settle.
 *
 *   business.inactiveRestaurantDays A cafe that has taken no orders for a week
 *   business.atRiskRestaurantDays   is not a customer at risk. We provide their
 *                                   software; we do not run their kitchen.
 *                                   Renewal date and payment status are the
 *                                   real churn signals, and both now have
 *                                   somewhere to live (Subscription, Invoice).
 *
 *   security.sessionTimeoutHours    Never read — SESSION_TTL_HOURS is a
 *                                   constant in the auth service. Removed
 *                                   rather than left looking configurable.
 *   security.require2faForPrivileged Never read either. 2FA enforcement is a
 *                                   real gap, but a setting nothing consults
 *                                   was not enforcing it.
 *
 * The rows are deleted by the commercial-model migration. This module keeps the
 * cached-read helper because company name and support contact are still read on
 * hot paths, and because a settings surface will return once Dineink defines
 * one — but nothing invents a setting to fill a screen.
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

export const getCompanyProfile = async () => ({
  name: await getSetting<string>(SETTING_KEYS.COMPANY_NAME, "DineInk"),
  supportEmail: await getSetting<string | null>(SETTING_KEYS.COMPANY_SUPPORT_EMAIL, null),
  supportPhone: await getSetting<string | null>(SETTING_KEYS.COMPANY_SUPPORT_PHONE, null),
});
