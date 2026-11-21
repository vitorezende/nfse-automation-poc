// Boots the real Portal da Contabilidade against throwaway Postgres and RabbitMQ containers.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import amqp from 'amqplib';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
export const COMMAND_QUEUE = 'robot.issue-nfse';

export interface Harness {
  app: INestApplication;
  rabbit: StartedTestContainer;
  /** Publishes an NFS-e event as the Robô de Emissão would, on the events exchange. */
  publishEvent(event: Record<string, any>, routingKey: string): Promise<void>;
  /** Base URL of the app listening on a real port (for streaming endpoints). */
  baseUrl: string;
  /** Removes and returns the next command on the robot's queue, or null if none arrives in time. */
  takeCommand(timeoutMs?: number): Promise<Record<string, any> | null>;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const [postgres, rabbit] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new GenericContainer('rabbitmq:4.1-management-alpine')
      .withCopyFilesToContainer([
        { source: join(repoRoot, 'infra/rabbitmq/definitions.json'), target: '/etc/rabbitmq/definitions.json' },
        { source: join(repoRoot, 'infra/rabbitmq/10-definitions.conf'), target: '/etc/rabbitmq/conf.d/10-definitions.conf' },
      ])
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
      .start(),
  ]);
  const databaseUrl = postgresUrl(postgres);
  const rabbitUrl = `amqp://poc:poc@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'ignore' });

  process.env.DATABASE_URL = databaseUrl;
  process.env.RABBITMQ_URL = rabbitUrl;
  process.env.OUTBOX_POLL_INTERVAL_MS = '100';
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/configure-app.js');
  const { PrismaService } = await import('../src/prisma.service.js');
  const { seedPrestadores } = await import('../src/seed-data.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  await seedPrestadores(app.get(PrismaService));

  // Reconnects lazily, so tests that restart the broker keep observing the queue.
  let connection: amqp.ChannelModel | undefined;
  let channel: amqp.Channel | undefined;
  const getChannel = async () => {
    if (!channel) {
      connection = await amqp.connect(rabbitUrl);
      connection.on('error', () => undefined);
      connection.on('close', () => ((connection = undefined), (channel = undefined)));
      channel = await connection.createChannel();
      channel.on('error', () => undefined);
      channel.on('close', () => (channel = undefined));
    }
    return channel;
  };

  return {
    app,
    rabbit,
    baseUrl,
    async publishEvent(event, routingKey) {
      const ch = await getChannel();
      ch.publish('nfse.events', routingKey, Buffer.from(JSON.stringify(event)), {
        contentType: 'application/json',
        messageId: event.messageId,
        persistent: true,
      });
    },
    async takeCommand(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const message = await (await getChannel()).get(COMMAND_QUEUE, { noAck: true });
          if (message) return JSON.parse(message.content.toString());
        } catch {
          channel = undefined; // broker restarting: retry until the deadline
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    },
    async stop() {
      await connection?.close().catch(() => undefined);
      await app.close();
      await Promise.all([postgres.stop(), rabbit.stop()]);
    },
  };
}

function postgresUrl(container: StartedPostgreSqlContainer): string {
  return container.getConnectionUri();
}
