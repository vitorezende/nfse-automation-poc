-- AlterTable
ALTER TABLE "TimelineEntry" ADD COLUMN     "artifactsBucket" TEXT,
ADD COLUMN     "screenshotKey" TEXT,
ADD COLUMN     "traceKey" TEXT;
