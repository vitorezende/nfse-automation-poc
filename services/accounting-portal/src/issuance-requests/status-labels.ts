import type { IssuanceRequestStatus } from '../generated/prisma/client.js';

export const STATUS_LABELS: Record<IssuanceRequestStatus, string> = {
  DRAFT: 'Rascunho',
  DISPATCHED: 'Enviada',
  PROCESSING: 'Em processamento',
  ISSUED: 'Emitida',
  FAILED: 'Falhou',
};

export const EVENT_LABELS: Record<string, string> = {
  NfseIssuanceStarted: 'Robô iniciou a emissão',
  NfseIssuanceAttemptFailed: 'Tentativa falhou',
  NfseIssued: 'NFS-e emitida',
  NfseIssuanceFailed: 'Emissão falhou',
};
