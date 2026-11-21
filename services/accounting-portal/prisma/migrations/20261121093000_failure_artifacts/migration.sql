-- AlterTable
ALTER TABLE "TimelineEntry" ADD COLUMN     "screenshotBucket" TEXT,
ADD COLUMN     "screenshotKey" TEXT,
ADD COLUMN     "traceBucket" TEXT,
ADD COLUMN     "traceKey" TEXT;
