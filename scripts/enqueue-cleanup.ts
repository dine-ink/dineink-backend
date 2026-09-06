import "dotenv/config";
import prisma from "../src/config/prisma";
import { enqueue } from "../src/jobs/queue";
import { CLEANUP_EXPIRED_SESSIONS } from "../src/jobs/handlers/cleanupExpiredSessions";

/**
 * Queues the housekeeping job. Intended for a nightly schedule:
 *
 *   0 3 * * *  cd /app && npm run jobs:cleanup
 */
(async () => {
  const { id, deduped } = await enqueue(
    CLEANUP_EXPIRED_SESSIONS,
    {},
    { dedupeKey: "cleanup-expired-sessions", maxAttempts: 3 },
  );
  console.log(deduped ? `cleanup already queued (job ${id})` : `queued cleanup (job ${id})`);
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
