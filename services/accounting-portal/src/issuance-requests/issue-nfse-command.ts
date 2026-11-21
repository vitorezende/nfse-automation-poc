import { randomUUID } from 'node:crypto';
import type { IssuanceRequest, Prestador } from '../generated/prisma/client.js';

export const ISSUE_NFSE_QUEUE = 'robot.issue-nfse';

/** Builds the IssueNfse command (contracts/schemas/issue-nfse.schema.json). Never includes a password. */
export function buildIssueNfseCommand(request: IssuanceRequest, prestador: Prestador) {
  return {
    messageId: randomUUID(),
    correlationId: request.correlationId,
    causationId: null,
    type: 'IssueNfse',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      issuanceRequestId: request.id,
      rps: { number: request.rpsNumber, series: request.rpsSeries },
      prestador: { cnpj: prestador.cnpj, credentialRef: prestador.credentialRef },
      tomador: { cnpj: request.tomadorCnpj, name: request.tomadorName },
      servico: { code: request.servicoCode, description: request.servicoDescription, issRate: request.issRate.toNumber() },
      amount: request.amount.toFixed(2),
      competencia: request.competencia,
      discriminacao: request.discriminacao,
    },
  };
}
