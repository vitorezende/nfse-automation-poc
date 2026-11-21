-- AlterTable
ALTER TABLE "IssuanceRequest" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "nfseIssuedAt" TIMESTAMP(3),
ADD COLUMN     "nfseNumber" TEXT,
ADD COLUMN     "nfseVerificationCode" TEXT;

-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" SERIAL NOT NULL,
    "issuanceRequestId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedMessage" (
    "messageId" UUID NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedMessage_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "TimelineEntry_issuanceRequestId_occurredAt_idx" ON "TimelineEntry"("issuanceRequestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_issuanceRequestId_fkey" FOREIGN KEY ("issuanceRequestId") REFERENCES "IssuanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
