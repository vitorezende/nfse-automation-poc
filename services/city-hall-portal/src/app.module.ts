import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { ChaosController } from './chaos/chaos.controller.js';
import { ChaosMiddleware } from './chaos/chaos.middleware.js';
import { ChaosService } from './chaos/chaos.service.js';
import { RedirectToLoginFilter } from './auth/authenticated.guard.js';
import { NfseController } from './nfse/nfse.controller.js';
import { NfseService } from './nfse/nfse.service.js';
import { PrismaService } from './prisma.service.js';

@Module({
  controllers: [AuthController, NfseController, ChaosController],
  providers: [PrismaService, NfseService, ChaosService, { provide: APP_FILTER, useClass: RedirectToLoginFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ChaosMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
