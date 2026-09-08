-- Durable background jobs, backed by Postgres rather than a broker.
--
-- This deployment runs one Node process and no Redis. The work that needs to
-- be asynchronous — refreshing a Jira status, retrying an integration call,
-- tidying expired sessions — is low-volume and latency-tolerant, so Postgres
-- with FOR UPDATE SKIP LOCKED is sufficient and adds no new infrastructure.
--
-- Jobs are claimed by a separate worker process (npm run worker), never by a
-- timer inside the API: a timer fires once per instance and would multiply
-- with every instance added.

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_status_idx" ON "BackgroundJob"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_dedupeKey_key" ON "BackgroundJob"("dedupeKey");

