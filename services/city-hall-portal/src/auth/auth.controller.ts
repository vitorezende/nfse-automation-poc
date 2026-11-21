import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma.service.js';
import { verifyPassword } from './password.js';

@Controller()
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('login')
  loginPage(@Res() res: Response): void {
    res.render('login', { title: 'Acesso ao sistema' });
  }

  @Post('login')
  async login(
    @Body() body: { username?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const prestador = body.username
      ? await this.prisma.prestador.findUnique({ where: { username: body.username.trim() } })
      : null;
    const valid = prestador !== null && (await verifyPassword(body.password ?? '', prestador.passwordHash));
    if (!valid) {
      res.render('login', { title: 'Acesso ao sistema', error: 'Usuário ou senha inválidos.', username: body.username });
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
