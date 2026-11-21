import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma, type Nfse } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { parseDecimalInput } from './decimal-input.js';

export interface IssueNfseForm {
  rpsNumber?: string;
  rpsSeries?: string;
  tomadorCnpj?: string;
  tomadorName?: string;
  servicoCode?: string;
  servicoDescription?: string;
  issRatePercent?: string;
  amount?: string;
  competencia?: string;
  discriminacao?: string;
}

/** The Prefeitura refused the submission; the message is shown to the user as-is. */
export class NfseRejectedError extends Error {}

const VERIFICATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function verificationCode(): string {
  const pick = () => VERIFICATION_ALPHABET[randomInt(VERIFICATION_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
}

@Injectable()
export class NfseService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(prestadorId: number, form: IssueNfseForm): Promise<Nfse> {
    const rpsNumber = Number.parseInt(form.rpsNumber ?? '', 10);
    const rpsSeries = (form.rpsSeries ?? '').trim();
    const amount = parseDecimalInput(form.amount);
    const ratePercent = parseDecimalInput(form.issRatePercent);
    const required = [form.tomadorCnpj, form.tomadorName, form.servicoCode, form.servicoDescription, form.competencia, form.discriminacao];
    if (!Number.isInteger(rpsNumber) || rpsNumber < 1 || !rpsSeries) throw new NfseRejectedError('Número ou série do RPS inválido.');
    if (amount === null || amount.lte(0)) throw new NfseRejectedError('Valor do serviço inválido.');
    if (ratePercent === null) throw new NfseRejectedError('Alíquota do ISS inválida.');
    if (required.some((value) => !value?.trim())) throw new NfseRejectedError('Preencha todos os campos obrigatórios.');

    if (await this.findByRps(prestadorId, rpsNumber, rpsSeries)) {
      throw new NfseRejectedError(`O RPS ${rpsNumber} série ${rpsSeries} já foi convertido em NFS-e.`);
    }

    const issRate = ratePercent.div(100);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.nfse.create({
          data: {
            prestadorId,
            verificationCode: verificationCode(),
            rpsNumber,
            rpsSeries,
            tomadorCnpj: form.tomadorCnpj!.trim(),
            tomadorName: form.tomadorName!.trim(),
            servicoCode: form.servicoCode!.trim(),
            servicoDescription: form.servicoDescription!.trim(),
            issRate,
            amount,
            issAmount: amount.mul(issRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            competencia: form.competencia!.trim(),
            discriminacao: form.discriminacao!.trim(),
          },
        });
        const number = `${created.issuedAt.getFullYear()}${String(created.id).padStart(6, '0')}`;
        return tx.nfse.update({ where: { id: created.id }, data: { number } });
      });
    } catch (error) {
      // Two concurrent submissions of the same RPS: the unique index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new NfseRejectedError(`O RPS ${rpsNumber} série ${rpsSeries} já foi convertido em NFS-e.`);
      }
      throw error;
    }
  }

  findByRps(prestadorId: number, rpsNumber: number, rpsSeries: string): Promise<Nfse | null> {
    return this.prisma.nfse.findUnique({
      where: { prestadorId_rpsNumber_rpsSeries: { prestadorId, rpsNumber, rpsSeries } },
    });
  }

  findForPrestador(prestadorId: number, id: number): Promise<Nfse | null> {
    return this.prisma.nfse.findFirst({ where: { id, prestadorId } });
  }

  findWithPrestador(prestadorId: number, id: number) {
    return this.prisma.nfse.findFirst({ where: { id, prestadorId }, include: { prestador: true } });
  }

  recent(prestadorId: number): Promise<Nfse[]> {
    return this.prisma.nfse.findMany({ where: { prestadorId }, orderBy: { id: 'desc' }, take: 20 });
  }
}
