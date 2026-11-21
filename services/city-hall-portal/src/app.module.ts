import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { RedirectToLoginFilter } from './auth/authenticated.guard.js';
import { NfseController } from './nfse/nfse.controller.js';
import { NfseService } from './nfse/nfse.service.js';
import { PrismaService } from './prisma.service.js';

@Module({
  controllers: [AuthController, NfseController],
  providers: [PrismaService, NfseService, { provide: APP_FILTER, useClass: RedirectToLoginFilter }],
})
export class AppModule {}
