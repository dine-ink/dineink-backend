-- Brute-force protection for restaurant sign-in.
--
-- The internal console already locked an account after five bad passwords, but
-- the restaurant-facing login — the one that opens a restaurant's sales,
-- payroll and bank records — had no per-account limit at all. The IP rate
-- limiter added alongside it bounds how fast one address can guess; it does
-- nothing about a distributed attempt against a single known account.
--
-- Failures are rows rather than a counter on User so the hour is a true sliding
-- window: a counter that resets on a fixed boundary lets an attacker spend 19
-- guesses either side of it and never trip the limit.

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "identifier" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- The lockout query: failures for one user since a given instant.
-- CreateIndex
CREATE INDEX "LoginAttempt_userId_createdAt_idx" ON "LoginAttempt"("userId", "createdAt");

-- Attempts against an address that matches no account carry no userId; this
-- index is what makes those visible.
-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "passwordLockedAt" TIMESTAMP(3),
    ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- Existing accounts have never had a recorded password change. Seeding this to
-- their creation time means the very first lockout window for an existing user
-- is counted from a real instant rather than from NULL, which would otherwise
-- make every historical row eligible the moment LoginAttempt starts filling.
UPDATE "User" SET "passwordChangedAt" = "createdAt" WHERE "passwordChangedAt" IS NULL;
