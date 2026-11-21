import { MessageHandlerErrorBehavior, Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type IssuanceRequestStatus } from '../generated/prisma/client.js';
import { IssuanceUpdates } from '../issuance-requests/issuance-updates.js';
import { PrismaService } from '../prisma.service.js';
import { ContractValidator } from './contract-validator.js';

interface ObjectRef {
  bucket: string;
  key: string;
}

interface NfseEvent {
  messageId: string;
  correlationId: string;
  type: 'NfseIssuanceStarted' | 'NfseIssuanceAttemptFailed' | 'NfseIssued' | 'NfseIssuanceFailed';
  occurredAt: string;
  payload: {
    issuanceRequestId: string;
    attempt: number;
    reason?: string;
    errorCategory?: string;
    nfse?: { number: string; verificationCode: string; issuedAt: string };
    documents?: { xml: ObjectRef; pdf: ObjectRef };
    artifacts?: { screenshot?: ObjectRef; trace?: ObjectRef };
  };
}

/** Statuses an event may move a Solicitação out of. Anything else would be a regression and is ignored. */
const TRANSITIONS: Partial<Record<NfseEvent['type'], { from: IssuanceRequestStatus[]; to: IssuanceRequestStatus }>> = {
  NfseIssuanceStarted: { from: ['DRAFT', 'DISPATCHED'], to: 'PROCESSING' },
  // The NFS-e exists at the Prefeitura: that truth wins even over an earlier failure.
  NfseIssued: { from: ['DRAFT', 'DISPATCHED', 'PROCESSING', 'FAILED'], to: 'ISSUED' },
  NfseIssuanceFailed: { from: ['DRAFT', 'DISPATCHED', 'PROCESSING'], to: 'FAILED' },
};

/**
 * Applies the robot's events to Solicitações. Each event is handled once (inbox on messageId), is always
 * recorded on the timeline, and changes the status only forward.
 */
@Injectable()
export class NfseEventsConsumer {
  private readonly logger = new Logger(NfseEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractValidator,
    private readonly updates: IssuanceUpdates,
  ) {}

  @RabbitSubscribe({
    queue: 'accounting.nfse-events',
    createQueueIfNotExists: false,
    // Infrastructure failures (e.g. database down) requeue the event; it is never dropped.
    // Explicit rather than relying on the library default.
    errorBehavior: MessageHandlerErrorBehavior.REQUEUE,
  })
  async handle(message: unknown): Promise<void | Nack> {
    const violations = this.contracts.validate(message as { type?: unknown });
    if (violations.length > 0) {
      this.logger.warn(`Discarding event that breaks its contract: ${violations.join('; ')}`);
      return new Nack(false);
    }
    const event = message as NfseEvent;
    const applied = await this.apply(event);
    if (applied) this.updates.notify(event.payload.issuanceRequestId);
  }

  /** Returns false when the event was a duplicate or refers to an unknown Solicitação. */
  private async apply(event: NfseEvent): Promise<boolean> {
    const { issuanceRequestId, attempt } = event.payload;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedMessage.create({ data: { messageId: event.messageId } });
        const request = await tx.issuanceRequest.findUnique({ where: { id: issuanceRequestId } });
        if (!request) {
          this.logger.warn(`Event ${event.type} for unknown Solicitação ${issuanceRequestId}; ignored`);
          return false;
        }
        await tx.timelineEntry.create({
          data: {
            issuanceRequestId,
            messageId: event.messageId,
            type: event.type,
            attempt,
            detail: this.detail(event),
            occurredAt: new Date(event.occurredAt),
            screenshotBucket: event.payload.artifacts?.screenshot?.bucket,
            screenshotKey: event.payload.artifacts?.screenshot?.key,
            traceBucket: event.payload.artifacts?.trace?.bucket,
            traceKey: event.payload.artifacts?.trace?.key,
          },
        });
        const transition = TRANSITIONS[event.type];
        if (transition) {
          await tx.issuanceRequest.updateMany({
            where: {
              id: issuanceRequestId,
              OR: [
                { status: { in: transition.from } },
                // A Falhou Solicitação with a pending Reprocessamento is effectively Enviada: the new round's
                // events may arrive before the outbox relay has marked it so.
                ...(transition.from.includes('DISPATCHED') ? [{ status: 'FAILED' as const, reprocessRequestedAt: { not: null } }] : []),
              ],
            },
            data: {
              status: transition.to,
              // Once the new round reports back, the relay must no longer treat the row as pending.
              reprocessRequestedAt: null,
              ...(event.type === 'NfseIssued' && {
                nfseNumber: event.payload.nfse!.number,
                nfseVerificationCode: event.payload.nfse!.verificationCode,
                nfseIssuedAt: new Date(event.payload.nfse!.issuedAt),
                documentsBucket: event.payload.documents!.xml.bucket,
                nfseXmlKey: event.payload.documents!.xml.key,
                nfsePdfKey: event.payload.documents!.pdf.key,
                failureReason: null,
              }),
              ...(event.type === 'NfseIssuanceFailed' && { failureReason: event.payload.reason }),
            },
          });
        }
        this.logger.log(`Applied ${event.type} ${event.messageId} [correlationId=${event.correlationId}]`);
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Duplicate event ${event.messageId} discarded`);
        return false;
      }
      throw error;
    }
  }

  private detail(event: NfseEvent): string | null {
    switch (event.type) {
      case 'NfseIssued':
        return `NFS-e ${event.payload.nfse!.number}`;
      case 'NfseIssuanceAttemptFailed':
      case 'NfseIssuanceFailed':
        return `${event.payload.errorCategory === 'business' ? 'Erro de negócio' : 'Erro transitório'}: ${event.payload.reason}`;
      default:
        return null;
    }
  }
}
