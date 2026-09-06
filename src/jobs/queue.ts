import prisma from "../config/prisma";

/**
 * A durable job queue backed by Postgres.
 *
 * WHY NOT REDIS/BULLMQ
 * This deployment runs one Node process and no broker. The work that needs to
 * be asynchronous — syncing a Jira status, retrying an integration call,
 * tidying expired sessions — is low-volume and latency-tolerant. Postgres
 * already gives durability, transactions, and safe concurrent claiming through
 * `FOR UPDATE SKIP LOCKED`. Adding Redis would mean another service to run,
 * monitor and pay for, in exchange for throughput nobody needs yet.
 *
 * WHAT THIS IS NOT
 * It is not a scheduler and it is not `setInterval` pretending to be a queue.
 * Jobs are rows; a separate worker process (`npm run worker`) claims and runs
 * them. If the API process dies mid-job the row is still there, still claimable
 * once its lock goes stale.
 *
 * WHERE THIS STOPS SCALING
 * Polling costs one query per interval per worker, and claiming serialises on
 * the index. Somewhere in the thousands-of-jobs-per-second range a broker earns
 * its keep. Handlers take a payload and return, so that migration is a change
 * to this file rather than to any of them.
 */

export interface JobContext {
  jobId: number;
  attempt: number;
  /** Attempts remaining after this one, so a handler can decide to give up early. */
  attemptsLeft: number;
}

export type JobHandler<T = any> = (payload: T, context: JobContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();

/**
 * Registers what to do for a job type.
 *
 * Registration is explicit rather than by file convention so an unregistered
 * type fails loudly at claim time instead of silently succeeding.
 */
export const registerHandler = <T>(type: string, handler: JobHandler<T>): void => {
  if (handlers.has(type)) {
    throw new Error(`Two handlers registered for job type "${type}"`);
  }
  handlers.set(type, handler as JobHandler);
};

export const registeredTypes = (): string[] => [...handlers.keys()];

export interface EnqueueOptions {
  /** Delay before the job becomes eligible. */
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Collapses duplicates. While a job with this key is PENDING/RUNNING/FAILED,
   * enqueuing it again is a no-op — "sync ticket 42" queued five times by five
   * page loads should run once.
   */
  dedupeKey?: string;
}

/**
 * Adds a job.
 *
 * Deliberately returns the row rather than throwing on a duplicate: the caller
 * usually does not care whether it queued a new job or found one already
 * waiting, and making them handle a conflict would push retry logic into every
 * call site.
 */
export const enqueue = async <T>(
  type: string,
  payload: T,
  options: EnqueueOptions = {},
): Promise<{ id: number; deduped: boolean }> => {
  if (options.dedupeKey) {
    const existing = await prisma.backgroundJob.findFirst({
      where: {
        dedupeKey: options.dedupeKey,
        status: { in: ["PENDING", "RUNNING", "FAILED"] },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }

  try {
    const job = await prisma.backgroundJob.create({
      data: {
        type,
        payload: payload as any,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 5,
        dedupeKey: options.dedupeKey ?? null,
      },
      select: { id: true },
    });
    return { id: job.id, deduped: false };
  } catch (error: any) {
    // Two callers can pass the dedupe check simultaneously; the unique index is
    // what actually enforces it, and losing that race is a successful dedupe
    // rather than an error worth surfacing.
    if (error?.code === "P2002" && options.dedupeKey) {
      const existing = await prisma.backgroundJob.findFirst({
        where: { dedupeKey: options.dedupeKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, deduped: true };
    }
    throw error;
  }
};

/**
 * Exponential backoff with a ceiling.
 *
 * 30s, 2m, 8m, 32m, capped at an hour. Slow enough that a struggling
 * integration is not hammered, quick enough that a transient blip clears
 * without anyone noticing.
 */
export const backoffFor = (attempt: number): Date => {
  const seconds = Math.min(30 * 4 ** (attempt - 1), 3600);
  return new Date(Date.now() + seconds * 1000);
};

/**
 * A job that has been RUNNING longer than this is presumed abandoned — its
 * worker crashed or was redeployed mid-run — and becomes claimable again.
 *
 * The consequence is that a handler must tolerate being run twice for the same
 * job. Every handler in this codebase is written to be idempotent for exactly
 * this reason.
 */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Claims one job.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe with several workers: each
 * takes a different row rather than blocking on the same one. Done as raw SQL
 * because Prisma has no way to express it.
 */
export const claimNext = async (workerId: string) => {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);

  const rows = await prisma.$queryRaw<
    { id: number; type: string; payload: any; attempts: number; maxAttempts: number }[]
  >`
    UPDATE "BackgroundJob"
    SET "status"    = 'RUNNING',
        "lockedAt"  = NOW(),
        "lockedBy"  = ${workerId},
        "attempts"  = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE ("status" IN ('PENDING', 'FAILED') AND "runAt" <= NOW())
         OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"
  `;

  return rows[0] ?? null;
};

export const markSucceeded = (jobId: number) =>
  prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      // Cleared so the key can be reused for the next sync of the same thing.
      dedupeKey: null,
    },
  });

export const markFailed = async (
  jobId: number,
  attempt: number,
  maxAttempts: number,
  error: unknown,
) => {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = attempt >= maxAttempts;

  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: exhausted ? "DEAD" : "FAILED",
      // A dead job keeps its dedupeKey so the same work is not queued again
      // behind it — a broken integration should surface once, not every hour.
      runAt: exhausted ? undefined : backoffFor(attempt),
      lockedAt: null,
      lockedBy: null,
      lastError: message.slice(0, 2000),
      completedAt: exhausted ? new Date() : null,
    },
  });

  return { exhausted };
};

/** Runs one job if there is one. Returns whether it found work. */
export const runOnce = async (workerId: string): Promise<boolean> => {
  const job = await claimNext(workerId);
  if (!job) return false;

  const handler = handlers.get(job.type);
  if (!handler) {
    // An unregistered type is a deployment mistake — a job queued by a newer
    // version than the worker is running. Dead-lettered immediately rather than
    // retried, because retrying will not make the handler appear.
    await markFailed(job.id, job.maxAttempts, job.maxAttempts, new Error(`No handler for job type "${job.type}"`));
    console.error(`[jobs] no handler for "${job.type}" (job ${job.id}) — dead-lettered`);
    return true;
  }

  try {
    await handler(job.payload, {
      jobId: job.id,
      attempt: job.attempts,
      attemptsLeft: Math.max(0, job.maxAttempts - job.attempts),
    });
    await markSucceeded(job.id);
  } catch (error) {
    const { exhausted } = await markFailed(job.id, job.attempts, job.maxAttempts, error);
    console.error(
      `[jobs] ${job.type} (job ${job.id}) failed on attempt ${job.attempts}/${job.maxAttempts}` +
        `${exhausted ? " — dead-lettered" : ", will retry"}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return true;
};

/** Queue depth by status, for the System Health page. */
export const queueStats = async () => {
  const rows = await prisma.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } });
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  const oldestPending = await prisma.backgroundJob.findFirst({
    where: { status: { in: ["PENDING", "FAILED"] } },
    orderBy: { runAt: "asc" },
    select: { runAt: true },
  });

  return {
    pending: byStatus.PENDING ?? 0,
    running: byStatus.RUNNING ?? 0,
    failed: byStatus.FAILED ?? 0,
    dead: byStatus.DEAD ?? 0,
    succeeded: byStatus.SUCCEEDED ?? 0,
    oldestPendingAt: oldestPending?.runAt ?? null,
    registeredTypes: registeredTypes(),
  };
};
