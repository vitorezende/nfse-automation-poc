-- CreateEnum
CREATE TYPE "IssuanceRequestStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'PROCESSING', 'ISSUED', 'FAILED');

-- CreateTable
CREATE TABLE "Prestador" (
    "id" SERIAL NOT NULL,
    "cnpj" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentialRef" TEXT NOT NULL,
    "rpsSeries" TEXT NOT NULL DEFAULT 'A',
    "nextRpsNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Prestador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" SERIAL NOT NULL,
    "prestadorId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "issRate" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuanceRequest" (
    "id" UUID NOT NULL,
    "correlationId" UUID NOT NULL,
    "prestadorId" INTEGER NOT NULL,
    "rpsNumber" INTEGER NOT NULL,
    "rpsSeries" TEXT NOT NULL,
    "servicoCode" TEXT NOT NULL,
    "servicoDescription" TEXT NOT NULL,
    "issRate" DECIMAL(7,4) NOT NULL,
    "tomadorCnpj" TEXT NOT NULL,
    "tomadorName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "competencia" TEXT NOT NULL,
    "discriminacao" TEXT NOT NULL,
    "status" "IssuanceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "dispatchRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "issuanceRequestId" UUID NOT NULL,
    "exchange" TEXT NOT NULL,
    "routingKey" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prestador_cnpj_key" ON "Prestador"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "IssuanceRequest_prestadorId_rpsNumber_rpsSeries_key" ON "IssuanceRequest"("prestadorId", "rpsNumber", "rpsSeries");

-- CreateIndex
CREATE INDEX "OutboxMessage_publishedAt_createdAt_idx" ON "OutboxMessage"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_prestadorId_fkey" FOREIGN KEY ("prestadorId") REFERENCES "Prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuanceRequest" ADD CONSTRAINT "IssuanceRequest_prestadorId_fkey" FOREIGN KEY ("prestadorId") REFERENCES "Prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
