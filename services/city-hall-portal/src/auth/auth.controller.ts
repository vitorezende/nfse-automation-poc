import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomInt } from 'node:crypto';
import { ChaosService } from '../chaos/chaos.service.js';
import { PrismaService } from '../prisma.service.js';
import { verifyPassword } from './password.js';

@Controller()
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chaos: ChaosService,
  ) {}

  @Get('login')
  loginPage(@Query('expirada') expired: string | undefined, @Req() req: Request, @Res() res: Response): void {
    this.renderLogin(req, res, { notice: expired ? 'Sua sessão expirou. Faça login novamente.' : undefined });
  }

  /** Renders the login form; with chaos captcha on, a fresh arithmetic challenge is kept in the session. */
  private renderLogin(req: Request, res: Response, extra: Record<string, unknown>): void {
    let captchaQuestion: string | undefined;
    if (this.chaos.current().captcha) {
      const a = randomInt(1, 10);
      const b = randomInt(1, 10);
      req.session.captchaAnswer = String(a + b);
      captchaQuestion = `${a} + ${b}`;
    }
    res.render('login', { title: 'Acesso ao sistema', captchaQuestion, ...extra });
  }

  @Post('login')
  async login(
    @Body() body: { username?: string; password?: string; captcha?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (this.chaos.current().captcha && (body.captcha ?? '').trim() !== req.session.captchaAnswer) {
      this.renderLogin(req, res, { error: 'Captcha inválido.', username: body.username });
      return;
    }
    const prestador = body.username
      ? await this.prisma.prestador.findUnique({ where: { username: body.username.trim() } })
      : null;
    const valid = prestador !== null && (await verifyPassword(body.password ?? '', prestador.passwordHash));
    if (!valid) {
      this.renderLogin(req, res, { error: 'Usuário ou senha inválidos.', username: body.username });
      return;
    }
    // Promisified so a failure surfaces through Nest's exception handling instead of crashing the process.
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.prestadorId = prestador.id;
    req.session.prestadorName = prestador.name;
    req.session.prestadorCnpj = prestador.cnpj;
    res.redirect('/');
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response): void {
    req.session.destroy(() => res.redirect('/login'));
  }
}
