import type { IssuanceRequestStatus } from '../generated/prisma/client.js';

export const STATUS_LABELS: Record<IssuanceRequestStatus, string> = {
  DRAFT: 'Rascunho',
  DISPATCHED: 'Enviada',
  PROCESSING: 'Em processamento',
  ISSUED: 'Emitida',
  FAILED: 'Falhou',
};
