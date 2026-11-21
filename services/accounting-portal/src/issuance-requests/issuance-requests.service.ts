import { Injectable } from '@nestjs/common';
import { Prisma, type IssuanceRequest, type Prestador, type TimelineEntry } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { buildIssueNfseCommand, ISSUE_NFSE_QUEUE } from './issue-nfse-command.js';

export interface CreateIssuanceRequestForm {
  prestadorCnpj?: string;
  servicoCode?: string;
  tomadorCnpj?: string;
  tomadorName?: string;
  amount?: string;
  competencia?: string;
  discriminacao?: string;
}

export class InvalidIssuanceRequestError extends Error {}

export type IssuanceRequestWithPrestador = IssuanceRequest & { prestador: Prestador; timeline?: TimelineEntry[] };

@Injectable()
export class IssuanceRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a Solicitação de Emissão as Rascunho, allocating the Prestador's next RPS number. */
  async create(form: CreateIssuanceRequestForm): Promise<IssuanceRequest> {
    const amount = /^\d+(\.\d{1,2})?$/.test(form.amount?.trim() ?? '') ? new Prisma.Decimal(form.amount!.trim()) : null;
    const text = [form.tomadorCnpj, form.tomadorName, form.competencia, form.discriminacao];
    if (amount === null || amount.lte(0)) throw new InvalidIssuanceRequestError('Informe um valor válido, por exemplo 1500.00.');
    if (text.some((value) => !value?.trim())) throw new InvalidIssuanceRequestError('Preencha todos os campos.');

    return this.prisma.$transaction(async (tx) => {
      const prestador = await tx.prestador.findUnique({ where: { cnpj: form.prestadorCnpj ?? '' } });
      if (!prestador) throw new InvalidIssuanceRequestError('Selecione um Prestador.');
      const servico = await tx.servico.findFirst({ where: { prestadorId: prestador.id, code: form.servicoCode ?? '' } });
      if (!servico) throw new InvalidIssuanceRequestError('Selecione um Serviço do catálogo do Prestador.');

      // Atomic increment: concurrent creations never share an RPS number.
      const { nextRpsNumber } = await tx.prestador.update({
        where: { id: prestador.id },
        data: { nextRpsNumber: { increment: 1 } },
      });
      return tx.issuanceRequest.create({
        data: {
          prestadorId: prestador.id,
          rpsNumber: nextRpsNumber - 1,
          rpsSeries: prestador.rpsSeries,
          servicoCode: servico.code,
          servicoDescription: servico.description,
          issRate: servico.issRate,
          tomadorCnpj: form.tomadorCnpj!.trim(),
          tomadorName: form.tomadorName!.trim(),
          amount,
          competencia: form.competencia!.trim(),
          discriminacao: form.discriminacao!.trim(),
        },
      });
    });
  }

  /**
   * Requests issuance: records the intent and the IssueNfse command in one transaction (outbox).
   * The status becomes Enviada only once the relay has published the command.
   */
  async dispatch(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.issuanceRequest.findUnique({ where: { id }, include: { prestador: true } });
      if (!request) throw new InvalidIssuanceRequestError('Solicitação não encontrada.');
      // The conditional update is the guard: of concurrent dispatches, exactly one matches the row.
      const { count } = await tx.issuanceRequest.updateMany({
        where: { id, status: 'DRAFT', dispatchRequestedAt: null },
        data: { dispatchRequestedAt: new Date() },
      });
      if (count === 0) return; // already dispatched: no-op
      await tx.outboxMessage.create({
        data: {
          issuanceRequestId: id,
          exchange: '',
          routingKey: ISSUE_NFSE_QUEUE,
          message: buildIssueNfseCommand(request, request.prestador),
        },
      });
    });
  }

  find(id: string): Promise<IssuanceRequestWithPrestador | null> {
    return this.prisma.issuanceRequest.findUnique({
      where: { id },
      include: { prestador: true, timeline: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } },
    });
  }

  list(): Promise<IssuanceRequestWithPrestador[]> {
    return this.prisma.issuanceRequest.findMany({ orderBy: { createdAt: 'desc' }, include: { prestador: true }, take: 100 });
  }

  prestadoresWithServicos() {
    return this.prisma.prestador.findMany({ orderBy: { name: 'asc' }, include: { servicos: { orderBy: { code: 'asc' } } } });
  }
}
