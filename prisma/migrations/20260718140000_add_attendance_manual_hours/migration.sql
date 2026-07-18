-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "manualTotalHours" DOUBLE PRECISION;
ALTER TABLE "Attendance" ADD COLUMN "overtimeHours" DOUBLE PRECISION DEFAULT 0;
