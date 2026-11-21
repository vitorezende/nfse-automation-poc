-- CreateTable
CREATE TABLE "Prestador" (
    "id" SERIAL NOT NULL,
    "cnpj" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "Prestador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nfse" (
    "id" SERIAL NOT NULL,
    "number" TEXT,
    "verificationCode" TEXT NOT NULL,
    "prestadorId" INTEGER NOT NULL,
    "rpsNumber" INTEGER NOT NULL,
    "rpsSeries" TEXT NOT NULL,
    "tomadorCnpj" TEXT NOT NULL,
    "tomadorName" TEXT NOT NULL,
    "servicoCode" TEXT NOT NULL,
    "servicoDescription" TEXT NOT NULL,
    "issRate" DECIMAL(7,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "issAmount" DECIMAL(14,2) NOT NULL,
    "competencia" TEXT NOT NULL,
    "discriminacao" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nfse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prestador_cnpj_key" ON "Prestador"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Prestador_username_key" ON "Prestador"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Nfse_number_key" ON "Nfse"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Nfse_prestadorId_rpsNumber_rpsSeries_key" ON "Nfse"("prestadorId", "rpsNumber", "rpsSeries");

-- AddForeignKey
ALTER TABLE "Nfse" ADD CONSTRAINT "Nfse_prestadorId_fkey" FOREIGN KEY ("prestadorId") REFERENCES "Prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
