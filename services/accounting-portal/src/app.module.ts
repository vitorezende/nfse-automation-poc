import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { IssuanceRequestsController } from './issuance-requests/issuance-requests.controller.js';
import { IssuanceRequestsService } from './issuance-requests/issuance-requests.service.js';
import { IssuanceUpdates } from './issuance-requests/issuance-updates.js';
import { ContractValidator } from './messaging/contract-validator.js';
import { NfseEventsConsumer } from './messaging/nfse-events.consumer.js';
import { OutboxRelay } from './outbox/outbox-relay.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [
    RabbitMQModule.forRoot({
      uri: process.env.RABBITMQ_URL ?? 'amqp://poc:poc@localhost:5672',
      // Start even when the broker is down: the outbox holds commands until it comes back.
      connectionInitOptions: { wait: false },
      // One event at a time keeps per-Solicitação ordering as published by the robot.
      prefetchCount: 1,
      enableControllerDiscovery: false,
    }),
  ],
  controllers: [IssuanceRequestsController],
  providers: [PrismaService, IssuanceRequestsService, OutboxRelay, ContractValidator, IssuanceUpdates, NfseEventsConsumer],
})
export class AppModule {}
