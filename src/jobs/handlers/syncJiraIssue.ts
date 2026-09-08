import prisma from "../../config/prisma";
import { fetchJiraIssue, isJiraConfigured } from "../../modules/internal/jira/jira.client";
import { registerHandler, enqueue } from "../queue";

export const SYNC_JIRA_ISSUE = "SYNC_JIRA_ISSUE";

export interface SyncJiraIssuePayload {
  ticketId: number;
}

/**
 * Refreshes a ticket's cached Jira status.
 *
 * Before this, the only way a Jira status updated was somebody opening the
 * ticket page — so the Engineering Issues list showed whatever was true the
 * last time each ticket happened to be viewed, which could be days old.
 *
 * Idempotent by construction: it reads Jira and writes what it finds. Running
 * it twice produces the same row, which matters because a worker that dies
 * mid-job leaves the job claimable again.
 *
 * Deliberately does NOT create issues, transition them, or write anything back
 * to Jira. Jira is the engineering system of record; this is a read.
 */
const handler = async (payload: SyncJiraIssuePayload) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: payload.ticketId },
    select: { id: true, ticketNo: true, jiraIssueKey: true, jiraStatus: true },
  });

  // Not an error: the ticket may have been closed, or its Jira link removed,
  // between the job being queued and it running. Nothing to do.
  if (!ticket?.jiraIssueKey) return;

  if (!isJiraConfigured()) {
    // Throwing would retry forever against a deployment that has no Jira
    // credentials, filling the dead-letter queue with noise. Returning leaves
    // the last known status in place, which is what the UI already shows.
    return;
  }

  const live = await fetchJiraIssue(ticket.jiraIssueKey);
  if (!live) {
    // fetchJiraIssue swallows transport failures and returns null. Raising here
    // is what earns the retry — a Jira blip should be tried again, not treated
    // as "the issue has no status".
    throw new Error(`Jira did not return ${ticket.jiraIssueKey}`);
  }

  if (live.status && live.status !== ticket.jiraStatus) {
    await prisma.$transaction([
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { jiraStatus: live.status, jiraSyncedAt: new Date() },
      }),
      // The change goes on the ticket's timeline so support can see when
      // engineering moved it without watching Jira.
      prisma.supportTicketEvent.create({
        data: {
          ticketId: ticket.id,
          type: "JIRA_STATUS_CHANGED",
          fromValue: ticket.jiraStatus,
          toValue: live.status,
          message: `${ticket.jiraIssueKey} moved to ${live.status}`,
        },
      }),
    ]);
    return;
  }

  // Unchanged: record that we looked, so "last synced" means something.
  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { jiraSyncedAt: new Date() },
  });
};

registerHandler<SyncJiraIssuePayload>(SYNC_JIRA_ISSUE, handler);

/**
 * Queues a sync for one ticket.
 *
 * The dedupe key collapses repeats: five people opening the same ticket queues
 * one job, not five.
 */
export const queueJiraSync = (ticketId: number) =>
  enqueue<SyncJiraIssuePayload>(
    SYNC_JIRA_ISSUE,
    { ticketId },
    { dedupeKey: `jira-sync:${ticketId}`, maxAttempts: 4 },
  );

/**
 * Queues a sync for every ticket with an open Jira link.
 *
 * Intended to be driven by an external scheduler (cron, or the platform's
 * scheduled-job feature) calling `npm run jobs:sync-jira`, rather than by a
 * timer inside the API process — a timer would fire once per instance and
 * multiply with every instance added.
 */
export const queueAllOpenJiraSyncs = async (): Promise<number> => {
  const tickets = await prisma.supportTicket.findMany({
    where: {
      jiraIssueKey: { not: null },
      status: { notIn: ["RESOLVED", "CLOSED"] },
    },
    select: { id: true },
  });

  for (const ticket of tickets) await queueJiraSync(ticket.id);
  return tickets.length;
};
