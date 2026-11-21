import { randomUUID } from 'node:crypto';

/** Builds contract-valid NFS-e events for a dispatched IssueNfse command, as the robot would publish them. */
export function eventFor(command: Record<string, any>, type: string, payload: Record<string, unknown> = {}) {
  const documents =
    type === 'NfseIssued'
      ? {
          documents: {
            xml: { bucket: 'nfse-documents', key: `${command.payload.issuanceRequestId}/nfse.xml` },
            pdf: { bucket: 'nfse-documents', key: `${command.payload.issuanceRequestId}/danfse.pdf` },
          },
        }
      : {};
  return {
    messageId: randomUUID(),
    correlationId: command.correlationId,
    causationId: command.messageId,
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { issuanceRequestId: command.payload.issuanceRequestId, rps: command.payload.rps, attempt: 1, ...documents, ...payload },
  };
}

export const ROUTING_KEYS: Record<string, string> = {
  NfseIssuanceStarted: 'nfse.issuance.started',
  NfseIssuanceAttemptFailed: 'nfse.issuance.attempt-failed',
  NfseIssued: 'nfse.issued',
  NfseIssuanceFailed: 'nfse.issuance.failed',
};
