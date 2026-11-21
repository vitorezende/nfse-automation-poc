import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Options } from 'amqplib';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

const PUBLISH_TIMEOUT_MS = 5_000;
const BATCH_SIZE = 20;

/**
 * Publishes pending outbox rows with publisher confirms, oldest first. A row is marked published
 * (and its Solicitação becomes Enviada) only after the broker confirmed it, so a crash or broker
 * outage leaves it pending and it is retried on the next tick. Delivery is therefore at-least-once;
 * the Robô de Emissão is idempotent per RPS (ADR 0002).
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpConnection,
  ) {}

  onApplicationBootstrap(): void {
    const interval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1_000);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishPending();
    } catch (error) {
      this.logger.warn(`Outbox publish deferred: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async publishPending(): Promise<void> {
    const pending = await this.prisma.outboxMessage.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    for (const row of pending) {
      const message = row.message as { messageId: string; correlationId: string; type: string };
      await this.amqp.publish(row.exchange, row.routingKey, message, {
        persistent: true,
        contentType: 'application/json',
        messageId: message.messageId,
        correlationId: message.correlationId,
        type: message.type,
        // amqp-connection-manager option: reject instead of buffering forever while disconnected.
        timeout: PUBLISH_TIMEOUT_MS,
      } as Options.Publish);
      await this.prisma.$transaction([
        this.prisma.outboxMessage.update({ where: { id: row.id }, data: { publishedAt: new Date() } }),
        this.prisma.issuanceRequest.updateMany({
          where: { id: row.issuanceRequestId, status: 'DRAFT' },
          data: { status: 'DISPATCHED' },
        }),
      ]);
      this.logger.log(`Published ${message.type} ${message.messageId} [correlationId=${message.correlationId}]`);
    }
  }
}
