import { serviceUnavailable } from "../shared/apiError";

/**
 * Jira integration.
 *
 * Jira stays the engineering execution source of truth — DineInk does not
 * build a second engineering tracker. An internal ticket is the *operational*
 * record ("a restaurant says the order never arrived"); once it's confirmed to
 * be a technical fault, a Jira issue is created and the two are linked by key.
 * Status flows back from Jira; it is never edited here.
 *
 * Two properties this client deliberately has:
 *
 *  - **It degrades.** If Jira isn't configured or is down, escalation fails with
 *    a clear message and the internal ticket is still marked escalated, so the
 *    operational record never depends on a third party being up.
 *
 *  - **It sends no customer PII.** The payload carries entity *ids* — restaurant,
 *    order, transaction — plus technical context. A Jira project typically has a
 *    far broader audience than the console does, and a customer's phone number
 *    has no business being in a bug report.
 */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
}

export const getJiraConfig = (): JiraConfig | null => {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    email,
    apiToken,
    projectKey,
    issueType: process.env.JIRA_ISSUE_TYPE || "Bug",
  };
};

export const isJiraConfigured = () => getJiraConfig() !== null;

const authHeader = (config: JiraConfig) =>
  `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;

// Jira occasionally takes several seconds; without a timeout a hung call would
// hold an employee's escalation request open until the proxy gives up.
const REQUEST_TIMEOUT_MS = 10_000;

const jiraFetch = async (config: JiraConfig, path: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: authHeader(config),
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return response;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw serviceUnavailable("Jira didn't respond in time. The ticket is escalated — link the Jira issue when it's back.", "JIRA_TIMEOUT");
    }
    throw serviceUnavailable("Couldn't reach Jira. The ticket is escalated — link the Jira issue when it's back.", "JIRA_UNREACHABLE");
  } finally {
    clearTimeout(timeout);
  }
};

export interface JiraIssueInput {
  ticketNo: string;
  title: string;
  description: string;
  priority: string;
  restaurantId?: number | null;
  orderId?: number | null;
  transactionId?: number | null;
  errorCode?: string | null;
  correlationId?: string | null;
  environment?: string | null;
  reportedBy: string;
}

/**
 * Jira Cloud expects Atlassian Document Format, not markdown or plain text —
 * posting a bare string silently produces an issue with an empty description.
 */
const toAdf = (input: JiraIssueInput) => {
  const contextLines = [
    ["Internal ticket", input.ticketNo],
    ["Reported by", input.reportedBy],
    ["Priority", input.priority],
    ["Restaurant", input.restaurantId ? `RES-${input.restaurantId}` : null],
    ["Order", input.orderId ? `ORD-${input.orderId}` : null],
    ["Transaction", input.transactionId ? `TXN-${input.transactionId}` : null],
    ["Error code", input.errorCode],
    ["Correlation ID", input.correlationId],
    ["Environment", input.environment],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: input.description }] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Context", marks: [{ type: "strong" }] }],
      },
      {
        type: "bulletList",
        content: contextLines.map(([label, value]) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: `${label}: `, marks: [{ type: "strong" }] },
                { type: "text", text: value },
              ],
            },
          ],
        })),
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Raised from the DineInk internal console. Customer contact details are deliberately not included — look them up in the console against the ids above.",
            marks: [{ type: "em" }],
          },
        ],
      },
    ],
  };
};

// Jira's own priority names differ per site configuration; these are the
// defaults on a standard Jira Cloud project. Overridable so a site with a
// custom scheme doesn't need a code change.
const priorityName = (priority: string) => {
  const map: Record<string, string> = {
    CRITICAL: process.env.JIRA_PRIORITY_CRITICAL || "Highest",
    HIGH: process.env.JIRA_PRIORITY_HIGH || "High",
    MEDIUM: process.env.JIRA_PRIORITY_MEDIUM || "Medium",
    LOW: process.env.JIRA_PRIORITY_LOW || "Low",
  };
  return map[priority] ?? "Medium";
};

export interface JiraIssueRef {
  key: string;
  url: string;
  status?: string | null;
}

export const createJiraIssue = async (input: JiraIssueInput): Promise<JiraIssueRef> => {
  const config = getJiraConfig();
  if (!config) {
    throw serviceUnavailable(
      "Jira isn't configured for this environment, so an issue can't be created automatically. The ticket is escalated — link a Jira issue manually once one exists.",
      "JIRA_NOT_CONFIGURED",
    );
  }

  const response = await jiraFetch(config, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: config.issueType },
        summary: `[${input.ticketNo}] ${input.title}`.slice(0, 254),
        description: toAdf(input),
        priority: { name: priorityName(input.priority) },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[jira] issue creation failed", response.status, body);
    throw serviceUnavailable(
      response.status === 401 || response.status === 403
        ? "Jira rejected our credentials. The ticket is escalated — an administrator needs to check the Jira integration settings."
        : "Jira couldn't create the issue. The ticket is escalated — link the Jira issue manually or try again.",
      "JIRA_CREATE_FAILED",
    );
  }

  const created = (await response.json()) as { key: string };
  return { key: created.key, url: `${config.baseUrl}/browse/${created.key}` };
};

/**
 * Current status of a linked issue. Returns null rather than throwing when Jira
 * is unavailable: a ticket page must still render when the integration is down,
 * showing the last known status instead of an error.
 */
export const fetchJiraIssue = async (issueKey: string): Promise<JiraIssueRef | null> => {
  const config = getJiraConfig();
  if (!config) return null;

  try {
    const response = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status,summary`);
    if (!response.ok) return null;
    const issue = (await response.json()) as { key: string; fields?: { status?: { name?: string } } };
    return {
      key: issue.key,
      url: `${config.baseUrl}/browse/${issue.key}`,
      status: issue.fields?.status?.name ?? null,
    };
  } catch {
    return null;
  }
};

export const buildJiraUrl = (issueKey: string): string | null => {
  const config = getJiraConfig();
  return config ? `${config.baseUrl}/browse/${issueKey}` : null;
};
