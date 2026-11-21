import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_LABELS } from './status-labels.js';
import {
  type CreateIssuanceRequestForm,
  InvalidIssuanceRequestError,
  type IssuanceRequestWithPrestador,
  IssuanceRequestsService,
} from './issuance-requests.service.js';

function toView(request: IssuanceRequestWithPrestador) {
  return {
    id: request.id,
    status: request.status,
    statusLabel:
      request.status === 'DRAFT' && request.dispatchRequestedAt ? 'Rascunho (envio pendente)' : STATUS_LABELS[request.status],
    canDispatch: request.status === 'DRAFT' && !request.dispatchRequestedAt,
    rps: `${request.rpsNumber} / ${request.rpsSeries}`,
    prestador: `${request.prestador.name} - CNPJ ${request.prestador.cnpj}`,
    tomador: `${request.tomadorName} - CNPJ ${request.tomadorCnpj}`,
    servico: `${request.servicoCode} - ${request.servicoDescription}`,
    issRate: `${request.issRate.mul(100).toFixed(2)}%`,
    amount: request.amount.toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    competencia: request.competencia,
    discriminacao: request.discriminacao,
    createdAt: request.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };
}

@Controller()
export class IssuanceRequestsController {
  constructor(private readonly issuanceRequests: IssuanceRequestsService) {}

  @Get()
  async list(@Res() res: Response): Promise<void> {
    const requests = await this.issuanceRequests.list();
    res.render('list', { title: 'Solicitações de Emissão', requests: requests.map(toView) });
  }

  @Get('solicitacoes/nova')
  async newPage(@Res() res: Response): Promise<void> {
    await this.renderForm(res, {});
  }

  /** HTMX partial: the Serviços of the selected Prestador. */
  @Get('servicos')
  async servicos(@Query('prestadorCnpj') prestadorCnpj: string, @Res() res: Response): Promise<void> {
    const prestadores = await this.issuanceRequests.prestadoresWithServicos();
    const prestador = prestadores.find((p) => p.cnpj === prestadorCnpj);
    res.render('partials/servico-options', { layout: false, servicos: prestador?.servicos.map(servicoView) ?? [] });
  }

  @Post('solicitacoes')
  async create(@Body() form: CreateIssuanceRequestForm, @Res() res: Response): Promise<void> {
    try {
      const created = await this.issuanceRequests.create(form);
      res.redirect(`/solicitacoes/${created.id}`);
    } catch (error) {
      if (!(error instanceof InvalidIssuanceRequestError)) throw error;
      res.status(422);
      await this.renderForm(res, form, error.message);
    }
  }

  @Post('solicitacoes/:id/emitir')
  async dispatch(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    try {
      await this.issuanceRequests.dispatch(id);
    } catch (error) {
      if (error instanceof InvalidIssuanceRequestError) throw new NotFoundException();
      throw error;
    }
    res.redirect(`/solicitacoes/${id}`);
  }

  @Get('solicitacoes/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const request = await this.issuanceRequests.find(id);
    if (!request) throw new NotFoundException();
    res.render('detail', { title: `Solicitação RPS ${request.rpsNumber}`, request: toView(request) });
  }

  private async renderForm(res: Response, form: CreateIssuanceRequestForm, error?: string): Promise<void> {
    const prestadores = await this.issuanceRequests.prestadoresWithServicos();
    const selected = prestadores.find((p) => p.cnpj === form.prestadorCnpj) ?? prestadores[0];
    res.render('new', {
      title: 'Nova Solicitação de Emissão',
      error,
      form,
      prestadores: prestadores.map((p) => ({ cnpj: p.cnpj, name: p.name, selected: p.cnpj === selected?.cnpj })),
      servicos: selected?.servicos.map((s) => ({ ...servicoView(s), selected: s.code === form.servicoCode })) ?? [],
    });
  }
}

function servicoView(servico: { code: string; description: string; issRate: { mul(n: number): { toFixed(d: number): string } } }) {
  return { code: servico.code, label: `${servico.code} - ${servico.description} (ISS ${servico.issRate.mul(100).toFixed(2)}%)` };
}
