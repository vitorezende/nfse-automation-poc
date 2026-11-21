import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Nfse } from '../generated/prisma/client.js';
import { AuthenticatedGuard } from '../auth/authenticated.guard.js';
import { formatBrl, formatPercent } from './decimal-input.js';
import { danfsePdf, nfseXml } from './nfse-documents.js';
import { type IssueNfseForm, NfseRejectedError, NfseService } from './nfse.service.js';

function toView(nfse: Nfse) {
  return {
    id: nfse.id,
    number: nfse.number,
    verificationCode: nfse.verificationCode,
    rps: `${nfse.rpsNumber} / ${nfse.rpsSeries}`,
    tomadorCnpj: nfse.tomadorCnpj,
    tomadorName: nfse.tomadorName,
    servico: `${nfse.servicoCode} - ${nfse.servicoDescription}`,
    issRate: formatPercent(nfse.issRate),
    amount: formatBrl(nfse.amount),
    issAmount: formatBrl(nfse.issAmount),
    competencia: nfse.competencia,
    discriminacao: nfse.discriminacao,
    issuedAt: nfse.issuedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };
}

@Controller()
@UseGuards(AuthenticatedGuard)
export class NfseController {
  constructor(private readonly nfse: NfseService) {}

  private session(req: Request) {
    return { prestadorName: req.session.prestadorName, prestadorCnpj: req.session.prestadorCnpj };
  }

  @Get()
  async home(@Req() req: Request, @Res() res: Response): Promise<void> {
    const recent = await this.nfse.recent(req.session.prestadorId!);
    res.render('home', { title: 'Página inicial', ...this.session(req), nfses: recent.map(toView) });
  }

  @Get('nfse/emitir')
  issuePage(@Req() req: Request, @Res() res: Response): void {
    res.render('nfse-issue', { title: 'Emissão de NFS-e', ...this.session(req), form: {} });
  }

  @Post('nfse/emitir')
  async issue(@Body() form: IssueNfseForm, @Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const nfse = await this.nfse.issue(req.session.prestadorId!, form);
      res.redirect(`/nfse/${nfse.id}`);
    } catch (error) {
      if (!(error instanceof NfseRejectedError)) throw error;
      res.render('nfse-issue', { title: 'Emissão de NFS-e', ...this.session(req), form, error: error.message });
    }
  }

  @Get('nfse/consulta')
  async queryByRps(
    @Query('rpsNumber') rpsNumber: string | undefined,
    @Query('rpsSeries') rpsSeries: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const searched = Boolean(rpsNumber && rpsSeries);
    const number = Number.parseInt(rpsNumber ?? '', 10);
    const found = searched && Number.isInteger(number)
      ? await this.nfse.findByRps(req.session.prestadorId!, number, rpsSeries!.trim())
      : null;
    res.render('nfse-query', {
      title: 'Consulta de NFS-e por RPS',
      ...this.session(req),
      rpsNumber,
      rpsSeries,
      searched,
      nfse: found ? toView(found) : null,
    });
  }

  @Get('nfse/:id/xml')
  async xml(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const found = await this.nfse.findWithPrestador(req.session.prestadorId!, id);
    if (!found) throw new NotFoundException();
    res.type('application/xml').attachment(`nfse-${found.number}.xml`).send(nfseXml(found, found.prestador));
  }

  @Get('nfse/:id/pdf')
  async pdf(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const found = await this.nfse.findWithPrestador(req.session.prestadorId!, id);
    if (!found) throw new NotFoundException();
    res.type('application/pdf').attachment(`danfse-${found.number}.pdf`).send(await danfsePdf(found, found.prestador));
  }

  @Get('nfse/:id')
  async detail(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nfse = await this.nfse.findForPrestador(req.session.prestadorId!, id);
    if (!nfse) throw new NotFoundException();
    res.render('nfse-detail', { title: `NFS-e ${nfse.number}`, ...this.session(req), nfse: toView(nfse) });
  }
}
