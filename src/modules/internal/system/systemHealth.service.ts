import prisma from "../../../config/prisma";
import { queueStats } from "../../../jobs/queue";
import { getJiraConfig } from "../jira/jira.client";

/**
 * System health.
 *
 * Every value here is measured at the moment you ask for it. There is no
 * metrics store behind this, so there are deliberately no uptime percentages,
 * error rates or latency percentiles — those need a time series nobody is
 * collecting, and inventing them on a health page is how an engineer ends up
 * trusting a number that was never true.
 *
 * What it does report is checkable: can we reach the database and how long did
 * it take, is each integration configured and does it answer, how big is the
 * data, and how long has this process been up.
 */

export interface HealthCheck {
  key: string;
  label: string;
  status: "OK" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED";
  detail: string;
  latencyMs?: number | null;
}

const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: unknown }> => {
  const started = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - started, value };
  } catch (error) {
    return { ms: Date.now() - started, error };
  }
};

const checkDatabase = async (): Promise<HealthCheck> => {
  const probe = await timed(() => prisma.$queryRaw`SELECT 1`);
  if (probe.error) {
    return { key: "database", label: "Database", status: "DOWN", detail: "Could not reach Postgres.", latencyMs: probe.ms };
  }
  // A read that touches a real table, not just the connection.
  const read = await timed(() => prisma.restaurant.count());
  return {
    key: "database",
    label: "Database",
    // Round-trip to a managed database in another region is tens of
    // milliseconds; several hundred means something is wrong upstream.
    status: read.ms > 1500 ? "DEGRADED" : "OK",
    detail: read.ms > 1500 ? `Responding slowly (${read.ms}ms for a simple count).` : "Connected and responding.",
    latencyMs: probe.ms,
  };
};

const checkJira = async (): Promise<HealthCheck> => {
  const config = getJiraConfig();
  if (!config) {
    return {
      key: "jira",
      label: "Jira",
      status: "NOT_CONFIGURED",
      detail: "No Jira credentials set. Escalation still works; issues must be linked by hand.",
    };
  }
  const probe = await timed(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(`${config.baseUrl}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  });
  if (probe.error) {
    return { key: "jira", label: "Jira", status: "DOWN", detail: "Configured but unreachable.", latencyMs: probe.ms };
  }
  const response = probe.value as Response;
  if (!response.ok) {
    return {
      key: "jira",
      label: "Jira",
      status: "DEGRADED",
      detail: `Reachable but rejected our credentials (HTTP ${response.status}).`,
      latencyMs: probe.ms,
    };
  }
  return { key: "jira", label: "Jira", status: "OK", detail: `Connected to project ${config.projectKey}.`, latencyMs: probe.ms };
};

/**
 * Configuration-only checks. Sending a real email or a real completion just to
 * colour a dot in would cost money and, in the mailer's case, deliver a message
 * to somebody — so these report whether credentials are present, and say so.
 */
const checkConfigured = (key: string, label: string, present: boolean, what: string): HealthCheck => ({
  key,
  label,
  status: present ? "OK" : "NOT_CONFIGURED",
  detail: present ? `Credentials present. ${what}` : `Not configured. ${what}`,
});

export const getSystemHealth = async () => {
  const jobs = await queueStats();

  const [database, jira] = await Promise.all([checkDatabase(), checkJira()]);

  const checks: HealthCheck[] = [
    database,
    jira,
    checkConfigured(
      "email",
      "Email (SendGrid)",
      Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
      "Not verified by sending — that would deliver a real message.",
    ),
    checkConfigured("ai", "OpenAI", Boolean(process.env.OPENAI_API_KEY), "Used by the restaurant-facing AI advisor."),
    checkConfigured(
      "internalJwt",
      "Internal token secret",
      Boolean(process.env.INTERNAL_JWT_SECRET),
      "Falls back to JWT_SECRET when unset; a dedicated secret is preferred.",
    ),
  ];

  const [restaurants, bills, customers, tickets, employees, logs, recentErrors] = await Promise.all([
    prisma.restaurant.count(),
    prisma.bill.count(),
    prisma.customer.count(),
    prisma.supportTicket.count(),
    prisma.internalUser.count(),
    prisma.applicationLog.count(),
    prisma.applicationLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
  ]);

  const memory = process.memoryUsage();

  return {
    checkedAt: new Date(),
    // Worst status wins — a page that says "OK" with a DOWN row on it is worse
    // than no page.
    overall: checks.some((c) => c.status === "DOWN")
      ? "DOWN"
      : checks.some((c) => c.status === "DEGRADED")
        ? "DEGRADED"
        : "OK",
    checks,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      rssMb: Math.round(memory.rss / 1024 / 1024),
      // This is one process. Behind a load balancer these numbers describe
      // whichever instance answered, not the fleet.
      note: "Measured on the instance that served this request.",
    },
    data: { restaurants, bills, customers, tickets, employees, logs },
    jobs,
    errors: { last24h: recentErrors },
  };
};
