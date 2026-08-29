-- Persisted application errors, so the correlation id the internal API returns
-- to an employee actually resolves to something searchable. Errors only, not a
-- general request log -- logging every request would put a write on the hot
-- path and bury the failures in noise.
--
-- Additive: one new table, no changes to anything existing.

CREATE TABLE "ApplicationLog" (
    "id" SERIAL NOT NULL,
    "correlationId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'ERROR',
    "service" TEXT NOT NULL DEFAULT 'internal-api',
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "actorId" INTEGER,
    "actorEmail" TEXT,
    "restaurantId" INTEGER,
    "orderId" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationLog_correlationId_idx" ON "ApplicationLog"("correlationId");
CREATE INDEX "ApplicationLog_createdAt_idx" ON "ApplicationLog"("createdAt");
CREATE INDEX "ApplicationLog_level_createdAt_idx" ON "ApplicationLog"("level", "createdAt");
CREATE INDEX "ApplicationLog_restaurantId_idx" ON "ApplicationLog"("restaurantId");
