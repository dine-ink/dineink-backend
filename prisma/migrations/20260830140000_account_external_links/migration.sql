-- CreateEnum
CREATE TYPE "ExternalSystem" AS ENUM ('DINEINK_RDS', 'DINEINK_DOT');

-- CreateTable
CREATE TABLE "AccountExternalLink" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "system" "ExternalSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalLabel" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "linkedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountExternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountExternalLink_accountId_idx" ON "AccountExternalLink"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountExternalLink_system_externalId_key" ON "AccountExternalLink"("system", "externalId");

-- AddForeignKey
ALTER TABLE "AccountExternalLink" ADD CONSTRAINT "AccountExternalLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

