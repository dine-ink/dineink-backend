-- Account lifecycle history.
--
-- Retention was previously "joined in month X and is a CUSTOMER today", which
-- cannot see a customer who churned and came back, and cannot answer "how many
-- customers did we have last March". Subscriptions already had their own event
-- log; accounts had nothing.

-- CreateTable
CREATE TABLE "AccountLifecycleEvent" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "fromStatus" "AccountLifecycleStatus",
    "toStatus" "AccountLifecycleStatus" NOT NULL,
    "reason" TEXT,
    "actorId" INTEGER,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountLifecycleEvent_accountId_createdAt_idx" ON "AccountLifecycleEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountLifecycleEvent_toStatus_createdAt_idx" ON "AccountLifecycleEvent"("toStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountLifecycleEvent" ADD CONSTRAINT "AccountLifecycleEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLifecycleEvent" ADD CONSTRAINT "AccountLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill
--
-- Every existing account gets exactly one synthetic row, marked isBackfilled,
-- carrying the account's own createdAt. That timestamp is genuinely all that is
-- known — nothing recorded when these accounts changed state, and inventing
-- transitions would produce a retention curve that looked authoritative and was
-- fiction.
--
-- Analytics excludes backfilled rows from point-in-time answers and says so on
-- screen. Real history accumulates from here.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "AccountLifecycleEvent" ("accountId", "fromStatus", "toStatus", "reason", "isBackfilled", "createdAt")
SELECT
    a."id",
    NULL,
    a."status",
    'Backfilled when lifecycle history was introduced. The account was already in this state; when it reached it is unknown.',
    true,
    a."createdAt"
FROM "Account" a;
