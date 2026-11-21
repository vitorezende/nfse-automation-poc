import { Body, ConflictException, Controller, Get, type MessageEvent, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, Sse } from '@nestjs/common';
import hbs from 'hbs';
import { concat, defer, filter, from, Observable, switchMap } from 'rxjs';
import type { TimelineEntry } from '../generated/prisma/client.js';
import { DocumentLinks } from '../storage/document-links.js';
import { IssuanceUpdates } from './issuance-updates.js';
import type { Response } from 'express';
import { EVENT_LABELS, STATUS_LABELS } from './status-labels.js';
import {
  type CreateIssuanceRequestForm,
  InvalidIssuanceRequestError,
  IssuanceRequestStateError,
  type IssuanceRequestWithPrestador,
  IssuanceRequestsService,
} from './issuance-requests.service.js';

function toView(request: IssuanceRequestWithPrestador) {
  return {
    id: request.id,
    correlationId: request.correlationId,
    status: request.status,
    statusLabel:
      request.status === 'DRAFT' && request.dispatchRequestedAt
        ? 'Rascunho (envio pendente)'
        : request.status === 'FAILED' && request.reprocessRequestedAt
          ? 'Falhou (reprocessamento pendente)'
          : STATUS_LABELS[request.status],
    canDispatch: request.status === 'DRAFT' && !request.dispatchRequestedAt,
    canReprocess: request.status === 'FAILED' && !request.reprocessRequestedAt,
    rps: `${request.rpsNumber} / ${request.rpsSeries}`,
    prestador: `${request.prestador.name} - CNPJ ${request.prestador.cnpj}`,
    tomador: `${request.tomadorName} - CNPJ ${request.tomadorCnpj}`,
    servico: `${request.servicoCode} - ${request.servicoDescription}`,
    issRate: `${request.issRate.mul(100).toFixed(2)}%`,
    amount: request.amount.toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    competencia: request.competencia,
    discriminacao: request.discriminacao,
    createdAt: formatDate(request.createdAt),
    nfseNumber: request.nfseNumber,
    nfseVerificationCode: request.nfseVerificationCode,
    nfseIssuedAt: request.nfseIssuedAt ? formatDate(request.nfseIssuedAt) : null,
    failureReason: request.failureReason,
    timeline: (request.timeline ?? []).map(timelineEntryView),
  };
}

function timelineEntryView(entry: TimelineEntry) {
  return {
    occurredAt: formatDate(entry.occurredAt),
    label: EVENT_LABELS[entry.type] ?? entry.type,
    attempt: entry.attempt > 0 ? entry.attempt : '',
    detail: entry.detail,
  };
}

function formatDate(date: Date): string {
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const renderLive = hbs.handlebars.compile('{{> request-live}}');

@Controller()
export class IssuanceRequestsController {
  constructor(
    private readonly issuanceRequests: IssuanceRequestsService,
    private readonly updates: IssuanceUpdates,
    private readonly documentLinks: DocumentLinks,
  ) {}

  /** The view model plus presigned links: NFS-e documents once issued, failure artifacts per timeline entry. */
  private async view(request: IssuanceRequestWithPrestador) {
    const link = (bucket: string | null, key: string | null, filename: string) =>
      bucket && key ? this.documentLinks.link(bucket, key, filename) : Promise.resolve(null);
    const timeline = Promise.all(
      (request.timeline ?? []).map(async (entry) => ({
        ...timelineEntryView(entry),
        screenshotUrl: await link(entry.screenshotBucket, entry.screenshotKey, `screenshot-attempt-${entry.attempt}.png`),
        traceUrl: await link(entry.traceBucket, entry.traceKey, `trace-attempt-${entry.attempt}.zip`),
      })),
    );
    const [xmlUrl, pdfUrl] = await Promise.all([
      link(request.documentsBucket, request.nfseXmlKey, `nfse-${request.nfseNumber}.xml`),
      link(request.documentsBucket, request.nfsePdfKey, `danfse-${request.nfseNumber}.pdf`),
    ]);
    return { ...toView(request), timeline: await timeline, xmlUrl, pdfUrl };
  }

  @Get()
  async list(@Res() res: Response): Promise<void> {
    const requests = await this.issuanceRequests.list();
    res.render('list', { title: 'Solicitações de Emissão', requests: requests.map(toView) });
  }

  @Get('solicitacoes/nova')
  async newPage(@Res() res: Response): Promise<void> {
    await this.renderForm(res, demoForm());
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

  @Post('solicitacoes/:id/reprocessar')
  async reprocess(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    try {
      await this.issuanceRequests.reprocess(id);
    } catch (error) {
      if (error instanceof InvalidIssuanceRequestError) throw new NotFoundException();
      if (error instanceof IssuanceRequestStateError) throw new ConflictException(error.message);
      throw error;
    }
    res.redirect(`/solicitacoes/${id}`);
  }

  /** Live region of the detail page: re-rendered and pushed (HTMX SSE) whenever an event is applied. */
  @Sse('solicitacoes/:id/eventos')
  events(@Param('id', ParseUUIDPipe) id: string): Observable<MessageEvent> {
    const changes = new Observable<string>((subscriber) => this.updates.subscribe((changed) => subscriber.next(changed)));
    const render = () =>
      defer(() => this.issuanceRequests.find(id)).pipe(
        filter((request) => request !== null),
        switchMap((request) => from(this.view(request!).then((view) => ({ type: 'update', data: renderLive({ request: view }) })))),
      );
    return concat(render(), changes.pipe(filter((changed) => changed === id), switchMap(render)));
  }

  @Get('solicitacoes/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const request = await this.issuanceRequests.find(id);
    if (!request) throw new NotFoundException();
    res.render('detail', { title: `Solicitação RPS ${request.rpsNumber}`, request: await this.view(request) });
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

/**
 * What Nova Solicitação opens with: a complete, valid Solicitação, so a demo is one click away. The Prestador
 * and Serviço are left out so the form falls back to the first of each.
 */
function demoForm(): CreateIssuanceRequestForm {
  return {
    tomadorCnpj: '22.222.222/0001-22',
    tomadorName: 'Tomador Exemplo Ltda',
    amount: '1500.00',
    competencia: currentCompetencia(),
    discriminacao: 'Suporte técnico mensal',
  };
}

/** The current month as AAAA-MM, in Brazil's time zone. */
function currentCompetencia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
}
