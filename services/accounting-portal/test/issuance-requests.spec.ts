import request from 'supertest';
import { loadValidator } from '../../../contracts/validator.mjs';
import { type Harness, startHarness } from './harness.js';

const validateMessage = loadValidator();

let harness: Harness;
beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness?.stop();
});

const http = () => request(harness.app.getHttpServer());

/** Reads `data-field` values from a server-rendered page. */
function field(html: string, name: string): string | undefined {
  return html.match(new RegExp(`data-field="${name}"[^>]*>([^<]*)<`))?.[1].trim();
}

async function createIssuanceRequest(overrides: Record<string, string> = {}) {
  const response = await http()
    .post('/solicitacoes')
    .type('form')
    .send({
      prestadorCnpj: '11.111.111/0001-11',
      servicoCode: '01.07',
      tomadorCnpj: '22.222.222/0001-22',
      tomadorName: 'Tomador Exemplo Ltda',
      amount: '1500.00',
      competencia: '2026-11',
      discriminacao: 'Suporte técnico mensal',
      ...overrides,
    });
  expect(response.status).toBe(302);
  return response.headers.location as string;
}

describe('Solicitação de Emissão', () => {
  it('is created as Rascunho with an RPS allocated for its Prestador', async () => {
    const location = await createIssuanceRequest();
    const page = (await http().get(location)).text;
    expect(field(page, 'status')).toBe('Rascunho');
    expect(field(page, 'rps')).toBe('1 / A');
    expect(field(page, 'tomador')).toBe('Tomador Exemplo Ltda - CNPJ 22.222.222/0001-22');
  });

  it('is dispatched as a contract-valid IssueNfse command and becomes Enviada', async () => {
    const location = await createIssuanceRequest({ amount: '2500.50', tomadorName: 'Cliente Dispatch SA' });
    await http().post(`${location}/emitir`).expect(302);

    const command = await harness.takeCommand();
    expect(command).not.toBeNull();
    expect(validateMessage(command).errors).toEqual([]);
    const issuanceRequestId = location.split('/').pop();
    expect(command!.type).toBe('IssueNfse');
    expect(command!.causationId).toBeNull();
    expect(command!.payload).toMatchObject({
      issuanceRequestId,
      rps: { series: 'A' },
      prestador: { cnpj: '11.111.111/0001-11', credentialRef: 'prestador-acme' },
      tomador: { cnpj: '22.222.222/0001-22', name: 'Cliente Dispatch SA' },
      servico: { code: '01.07', description: 'Suporte técnico em informática', issRate: 0.05 },
      amount: '2500.50',
      competencia: '2026-11',
      discriminacao: 'Suporte técnico mensal',
    });

    await vi.waitFor(async () => expect(field((await http().get(location)).text, 'status')).toBe('Enviada'));
  });

  it('stays pending while the broker is down and is published once it returns', async () => {
    await harness.rabbit.exec(['rabbitmqctl', 'stop_app']);
    try {
      const location = await createIssuanceRequest({ tomadorName: 'Cliente Broker Down' });
      await http().post(`${location}/emitir`).expect(302);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(field((await http().get(location)).text, 'status')).toBe('Rascunho (envio pendente)');
    } finally {
      await harness.rabbit.exec(['rabbitmqctl', 'start_app']);
    }

    const command = await harness.takeCommand(45_000);
    expect(command?.payload.tomador.name).toBe('Cliente Broker Down');
    // Exactly one command for this Solicitação, despite the retries during the outage.
    expect(await harness.takeCommand(2_000)).toBeNull();
  });

  it('dispatching twice publishes a single command', async () => {
    const location = await createIssuanceRequest({ tomadorName: 'Cliente Double Click' });
    await http().post(`${location}/emitir`).expect(302);
    await http().post(`${location}/emitir`).expect(302);
    expect((await harness.takeCommand())?.payload.tomador.name).toBe('Cliente Double Click');
    expect(await harness.takeCommand(2_000)).toBeNull();
  });

  it('concurrent dispatches of the same Solicitação publish a single command', async () => {
    const location = await createIssuanceRequest({ tomadorName: 'Cliente Concurrent' });
    await Promise.all(Array.from({ length: 5 }, () => http().post(`${location}/emitir`).expect(302)));
    expect((await harness.takeCommand())?.payload.tomador.name).toBe('Cliente Concurrent');
    expect(await harness.takeCommand(2_000)).toBeNull();
  });

  it('allocates sequential RPS numbers per Prestador', async () => {
    const first = (await http().get(await createIssuanceRequest({ prestadorCnpj: '33.444.555/0001-66', servicoCode: '07.02' }))).text;
    const second = (await http().get(await createIssuanceRequest({ prestadorCnpj: '33.444.555/0001-66', servicoCode: '07.03' }))).text;
    expect(field(first, 'rps')).toBe('1 / A');
    expect(field(second, 'rps')).toBe('2 / A');
  });

  it('accepts a Competência typed as MM/AAAA and dispatches it as AAAA-MM', async () => {
    const location = await createIssuanceRequest({ competencia: '11/2026' });
    await http().post(`${location}/emitir`).expect(302);

    const command = await harness.takeCommand();
    expect(validateMessage(command).errors).toEqual([]);
    expect(command!.payload).toMatchObject({ competencia: '2026-11' });
  });

  it.each(['13/2026', 'nov/2026', '2026-1'])('rejects the Competência %s', async (competencia) => {
    const response = await http()
      .post('/solicitacoes')
      .type('form')
      .send({ prestadorCnpj: '11.111.111/0001-11', servicoCode: '01.07', tomadorCnpj: '1', tomadorName: 'X', amount: '10.00', competencia, discriminacao: 'X' });
    expect(response.status).toBe(422);
    expect(response.text).toContain('Informe a competência no formato AAAA-MM, por exemplo 2026-11.');
  });

  it('rejects a Serviço outside the Prestador catalogue', async () => {
    const response = await http()
      .post('/solicitacoes')
      .type('form')
      .send({ prestadorCnpj: '11.111.111/0001-11', servicoCode: '07.02', tomadorCnpj: '1', tomadorName: 'X', amount: '10.00', competencia: '2026-11', discriminacao: 'X' });
    expect(response.status).toBe(422);
    expect(response.text).toContain('Selecione um Serviço do catálogo do Prestador.');
  });
});
