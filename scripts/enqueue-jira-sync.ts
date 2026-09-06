import "dotenv/config";
import prisma from "../src/config/prisma";
import { queueAllOpenJiraSyncs } from "../src/jobs/handlers/syncJiraIssue";

/**
 * Queues a Jira status refresh for every open, linked ticket.
 *
 * Run from an external scheduler — cron, or the hosting platform's scheduled
 * jobs — rather than from a timer inside the API. A timer would fire once per
 * instance, so three instances would queue everything three times.
 *
 *   */15 * * * *  cd /app && npm run jobs:sync-jira
 */
(async () => {
  const queued = await queueAllOpenJiraSyncs();
  console.log(`queued Jira sync for ${queued} ticket(s)`);
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
