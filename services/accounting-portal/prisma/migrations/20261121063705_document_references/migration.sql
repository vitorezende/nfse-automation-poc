-- AlterTable
ALTER TABLE "IssuanceRequest" ADD COLUMN     "documentsBucket" TEXT,
ADD COLUMN     "nfsePdfKey" TEXT,
ADD COLUMN     "nfseXmlKey" TEXT;
