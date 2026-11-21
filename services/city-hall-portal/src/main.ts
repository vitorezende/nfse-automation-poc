import './auth/session.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import { join } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(
    session({
      name: 'PREFSESSID',
      secret: process.env.SESSION_SECRET ?? 'local-demo-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 },
    }),
  );
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
