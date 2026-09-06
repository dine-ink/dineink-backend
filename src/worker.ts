import dotenv from "dotenv";

dotenv.config();

import os from "os";
import prisma from "./config/prisma";
import { assertSecretsConfigured } from "./config/secrets";
import { runOnce, registeredTypes } from "./jobs/queue";

// Importing a handler registers it. Explicit imports rather than directory
// scanning, so a handler that fails to load breaks the build instead of
// silently not existing at runtime.
import "./jobs/handlers/syncJiraIssue";
import "./jobs/handlers/cleanupExpiredSessions";

/**
 * The background worker.
 *
 * A separate process (`npm run worker`), not a timer inside the API. Two
 * reasons: a timer inside the API fires once per instance, so scaling to three
 * instances would run every job three times; and long work in the API process
 * competes with request handling for the event loop.
 *
 * The loop polls because the queue is Postgres. `LISTEN/NOTIFY` would remove
 * the idle polling, and is the obvious next step if the interval ever shows up
 * in the database's load — at one query every couple of seconds against an
 * indexed table, it does not today.
 *
 * Safe to run several of these. Claiming uses `FOR UPDATE SKIP LOCKED`, so
 * workers take different rows rather than colliding.
 */

const POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS ?? 2000);
const WORKER_ID = `${os.hostname()}-${process.pid}`;

let running = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loop = async () => {
  console.log(`[worker] ${WORKER_ID} started — handlers: ${registeredTypes().join(", ")}`);

  while (running) {
    try {
      // Drain rather than sleeping after each job: when there is a backlog we
      // work through it, and only wait once the queue is actually empty.
      const didWork = await runOnce(WORKER_ID);
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      // A failure here is the queue itself being unreachable, not a job
      // failing — those are handled inside runOnce. Back off rather than
      // spinning against a database that is down.
      console.error("[worker] queue error:", error instanceof Error ? error.message : error);
      await sleep(POLL_INTERVAL_MS * 5);
    }
  }

  console.log("[worker] stopped");
  await prisma.$disconnect();
  process.exit(0);
};

/**
 * Finishes the job in hand before exiting.
 *
 * Killing mid-job is survivable — the lock goes stale and another worker picks
 * it up — but a clean stop avoids the ten-minute wait for that to happen.
 */
const shutdown = (signal: string) => {
  console.log(`[worker] ${signal} received, finishing current job…`);
  running = false;
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

assertSecretsConfigured();
void loop();
