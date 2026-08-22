// Chunked bulk writes for the labor module.
//
// WHY THIS EXISTS: the labor-standards matrix is inherently a bulk surface — a
// 120-item menu across 10 stations is ~420 rows for one branch, and the
// "split prep time" seeder writes all of them in one request. Wrapping that many
// upserts in a single prisma.$transaction fails against a remote database:
// Prisma's interactive-transaction timeout defaults to 5s, and with ~50ms of
// round-trip latency per statement (this deployment's Postgres is on RDS in
// eu-north-1) only ~100 statements fit. The failure mode is a P2028
// "rollback cannot be executed on an expired transaction", which surfaces to the
// user as a generic 500 after the write has already partially happened.
//
// So: small chunks, each in its own transaction with an explicitly raised
// timeout. Atomicity is per chunk rather than across the whole batch — an
// acceptable trade for this data, since every write is an idempotent upsert of an
// independent (item, station) cell. A partially-applied batch leaves some cells
// updated and the rest at their previous values, and simply re-running finishes
// the job. That is materially better than the alternative, which is the whole
// operation reliably failing at scale.

import prisma from "../../config/prisma";

/**
 * Statements per transaction. 25 × ~50ms ≈ 1.3s of statement time, comfortably
 * inside the raised timeout below even if latency doubles.
 */
export const BATCH_CHUNK_SIZE = 25;

/** Raised well above Prisma's 5s default, so a slow chunk waits rather than exploding. */
const BATCH_TRANSACTION_TIMEOUT_MS = 30_000;
const BATCH_MAX_WAIT_MS = 10_000;

/**
 * Run `operations` in chunked transactions, returning how many were applied.
 *
 * Takes an array of thunks rather than pre-built Prisma promises: a Prisma
 * promise begins executing when created, so building 2000 of them up front would
 * fire them all outside any transaction. Deferring construction keeps each
 * statement inside its own chunk's transaction client.
 */
export const runChunkedWrites = async (
  operations: ((tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>)[],
  chunkSize: number = BATCH_CHUNK_SIZE,
): Promise<{ applied: number; chunks: number }> => {
  let applied = 0;
  let chunks = 0;

  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    await prisma.$transaction(
      async (tx) => {
        // Sequential inside the chunk: a transaction is a single connection, so
        // Promise.all here would not parallelise anything and only makes the
        // failure ordering harder to reason about.
        for (const op of chunk) await op(tx);
      },
      { timeout: BATCH_TRANSACTION_TIMEOUT_MS, maxWait: BATCH_MAX_WAIT_MS },
    );
    applied += chunk.length;
    chunks++;
  }

  return { applied, chunks };
};
