import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type ChaosSettings, ChaosService } from './chaos.service.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Unauthenticated on purpose: it's the demo presenter's control panel. */
@Controller('admin/chaos')
export class ChaosController {
  constructor(private readonly chaos: ChaosService) {}

  @Get()
  page(@Res() res: Response): void {
    const settings = this.chaos.current();
    res.render('chaos', {
      title: 'Modo caos',
      settings: {
        ...settings,
        submitErrorPercent: Math.round(settings.submitErrorProbability * 100),
        sessionExpiryPercent: Math.round(settings.sessionExpiryProbability * 100),
      },
    });
  }

  @Post()
  update(@Body() body: Record<string, string>, @Res() res: Response): void {
    const latencyMinMs = clamp(Number(body.latencyMinMs), 0, 30_000);
    const next: ChaosSettings = {
      latencyMinMs,
      latencyMaxMs: clamp(Number(body.latencyMaxMs), latencyMinMs, 30_000),
      submitErrorProbability: clamp(Number(body.submitErrorPercent) / 100, 0, 1),
      sessionExpiryProbability: clamp(Number(body.sessionExpiryPercent) / 100, 0, 1),
      maintenance: body.maintenance === 'on',
      captcha: body.captcha === 'on',
    };
    this.chaos.update(next);
    res.redirect('/admin/chaos');
  }
}
