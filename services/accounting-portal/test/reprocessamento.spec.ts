import request from 'supertest';
import { loadValidator } from '../../../contracts/validator.mjs';
import { eventFor, ROUTING_KEYS } from './events.js';
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
const page = async (location: string) => (await http().get(location)).text;
function field(html: string, name: string): string | undefined {
  return html.match(new RegExp(`data-field="${name}"[^>]*>([^<]*)<`))?.[1].trim();
}

async function dispatchedRequest() {
  const created = await http().post('/solicitacoes').type('form').send({
    prestadorCnpj: '22.333.444/0001-55',
    servicoCode: '17.19',
    tomadorCnpj: '10.000.000/0001-00',
    tomadorName: 'Tomador Reprocessamento',
    amount: '700.00',
    competencia: '2026-11',
    discriminacao: 'Honorários',
  });
  const location = created.headers.location as string;
  await http().post(`${location}/emitir`).expect(302);
  const command = await harness.takeCommand();
  if (!command) throw new Error('IssueNfse was not published');
  return { location, command };
}

async function failedRequest() {
  const { location, command } = await dispatchedRequest();
  await harness.publishEvent(
    eventFor(command, 'NfseIssuanceFailed', { attempt: 4, errorCategory: 'transient', reason: 'Retries exhausted' }),
    ROUTING_KEYS.NfseIssuanceFailed,
  );
  await vi.waitFor(async () => expect(field(await page(location), 'status')).toBe('Falhou'), { timeout: 10_000 });
  return { location, command };
}

describe('Reprocessamento', () => {
  it('re-dispatches a failed Solicitação with its original RPS and a new command', async () => {
    const { location, command: original } = await failedRequest();
    expect(await page(location)).toContain('Reprocessar');

    await http().post(`${location}/reprocessar`).expect(302);

    const command = await harness.takeCommand();
    expect(command).not.toBeNull();
    expect(validateMessage(command).errors).toEqual([]);
    expect(command!.messageId).not.toBe(original.messageId);
    expect(command!.payload.rps).toEqual(original.payload.rps);
    expect(command!.payload.issuanceRequestId).toBe(original.payload.issuanceRequestId);

    await vi.waitFor(async () => {
      const html = await page(location);
      expect(field(html, 'status')).toBe('Enviada');
      expect(html).toContain('Reprocessamento solicitado');
      expect(html).not.toContain('data-field="failureReason"');
    }, { timeout: 10_000 });
  });

  it('reprocessing twice publishes a single command', async () => {
    const { location } = await failedRequest();
    await Promise.all([1, 2, 3].map(() => http().post(`${location}/reprocessar`)));
    expect(await harness.takeCommand()).not.toBeNull();
    expect(await harness.takeCommand(2_000)).toBeNull();
  });

  it('is rejected for a Solicitação that has not failed', async () => {
    const { location } = await dispatchedRequest();
    const response = await http().post(`${location}/reprocessar`);
    expect(response.status).toBe(409);
    expect(await harness.takeCommand(2_000)).toBeNull();
    expect(await page(location)).not.toContain('Reprocessar');
  });
});
