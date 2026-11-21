import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ChaosService } from './chaos.service.js';

/** Applies the configured chaos to every portal page except the chaos page itself. */
@Injectable()
export class ChaosMiddleware implements NestMiddleware {
  constructor(private readonly chaos: ChaosService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.path.startsWith('/admin/chaos')) return next();
    const delay = this.chaos.latencyMs();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const settings = this.chaos.current();
    if (req.method === 'POST' && req.path === '/nfse/emitir' && this.chaos.roll(settings.submitErrorProbability)) {
      res.status(500).render('server-error', { title: 'Erro interno' });
      return;
    }
    next();
  }
}
