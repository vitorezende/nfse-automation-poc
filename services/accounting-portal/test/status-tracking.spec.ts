import request from 'supertest';
import { eventFor, ROUTING_KEYS } from './events.js';
import { type Harness, startHarness } from './harness.js';

let harness: Harness;
beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness?.stop();
});

const http = () => request(harness.app.getHttpServer());

function field(html: string, name: string): string | undefined {
  return html.match(new RegExp(`data-field="${name}"[^>]*>([^<]*)<`))?.[1].trim();
}

/** Creates and dispatches a Solicitação; returns its page URL and the IssueNfse command the robot received. */
async function dispatchedRequest(tomadorName = 'Tomador Status') {
  const created = await http()
    .post('/solicitacoes')
    .type('form')
    .send({
      prestadorCnpj: '11.111.111/0001-11',
      servicoCode: '01.07',
      tomadorCnpj: '22.222.222/0001-22',
      tomadorName,
      amount: '1000.00',
      competencia: '2026-11',
      discriminacao: 'Serviço de teste',
    });
  const location = created.headers.location as string;
  await http().post(`${location}/emitir`).expect(302);
  const command = await harness.takeCommand();
  if (!command) throw new Error('IssueNfse was not published');
  return { location, command };
}

async function publish(command: Record<string, any>, type: string, payload: Record<string, unknown> = {}) {
  const event = eventFor(command, type, payload);
  await harness.publishEvent(event, ROUTING_KEYS[type]);
  return event;
}

const page = async (location: string) => (await http().get(location)).text;

describe('Solicitação status tracking', () => {
  it('moves to Em processamento when the robot starts', async () => {
    const { location, command } = await dispatchedRequest();
    await publish(command, 'NfseIssuanceStarted');
    await vi.waitFor(async () => expect(field(await page(location), 'status')).toBe('Em processamento'), { timeout: 10_000 });
  });

  it('becomes Emitida with the NFS-e number and verification code', async () => {
    const { location, command } = await dispatchedRequest();
    await publish(command, 'NfseIssuanceStarted');
    await publish(command, 'NfseIssued', {
      nfse: { number: '2026000777', verificationCode: 'ABCD-2345', issuedAt: '2026-11-21T10:00:00Z' },
    });
    await vi.waitFor(async () => {
      const html = await page(location);
      expect(field(html, 'status')).toBe('Emitida');
      expect(field(html, 'nfseNumber')).toBe('2026000777');
      expect(field(html, 'nfseVerificationCode')).toBe('ABCD-2345');
    }, { timeout: 10_000 });
  });

  it('becomes Falhou with the reason', async () => {
    const { location, command } = await dispatchedRequest();
    await publish(command, 'NfseIssuanceFailed', { errorCategory: 'business', reason: 'Credenciais inválidas' });
    await vi.waitFor(async () => {
      const html = await page(location);
      expect(field(html, 'status')).toBe('Falhou');
      expect(field(html, 'failureReason')).toBe('Credenciais inválidas');
    }, { timeout: 10_000 });
  });

  it('records a failed attempt on the timeline without changing the status', async () => {
    const { location, command } = await dispatchedRequest();
    await publish(command, 'NfseIssuanceStarted');
    await publish(command, 'NfseIssuanceAttemptFailed', { errorCategory: 'transient', reason: 'Sessão expirada' });
    await vi.waitFor(async () => {
      const html = await page(location);
      expect(html).toContain('Erro transitório: Sessão expirada');
      expect(field(html, 'status')).toBe('Em processamento');
    }, { timeout: 10_000 });
  });

  it('ignores a duplicate event', async () => {
    const { location, command } = await dispatchedRequest();
    const event = eventFor(command, 'NfseIssuanceAttemptFailed', { errorCategory: 'transient', reason: 'Duplicada' });
    await harness.publishEvent(event, ROUTING_KEYS.NfseIssuanceAttemptFailed);
    await harness.publishEvent(event, ROUTING_KEYS.NfseIssuanceAttemptFailed);
    await publish(command, 'NfseIssuanceStarted'); // processed after both copies
    await vi.waitFor(async () => expect(field(await page(location), 'status')).toBe('Em processamento'), { timeout: 10_000 });
    expect((await page(location)).match(/Erro transitório: Duplicada/g)).toHaveLength(1);
  });

  it('never moves backwards when events arrive out of order', async () => {
    const { location, command } = await dispatchedRequest();
    await publish(command, 'NfseIssued', {
      nfse: { number: '2026000888', verificationCode: 'WXYZ-6789', issuedAt: '2026-11-21T10:00:00Z' },
    });
    await publish(command, 'NfseIssuanceStarted');
    await publish(command, 'NfseIssuanceFailed', { errorCategory: 'transient', reason: 'Atrasado' });
    await vi.waitFor(async () => expect(await page(location)).toContain('Erro transitório: Atrasado'), { timeout: 10_000 });
    const html = await page(location);
    expect(field(html, 'status')).toBe('Emitida');
    expect(field(html, 'nfseNumber')).toBe('2026000888');
  });

  it('discards an event that breaks its contract', async () => {
    const { location, command } = await dispatchedRequest();
    const broken = { ...eventFor(command, 'NfseIssued'), payload: { issuanceRequestId: command.payload.issuanceRequestId } };
    await harness.publishEvent(broken, ROUTING_KEYS.NfseIssued);
    await publish(command, 'NfseIssuanceStarted');
    await vi.waitFor(async () => expect(field(await page(location), 'status')).toBe('Em processamento'), { timeout: 10_000 });
  });

  it('pushes the new status to an open page through server-sent events', async () => {
    const { location, command } = await dispatchedRequest();
    const controller = new AbortController();
    const response = await fetch(`${harness.baseUrl}${location}/eventos`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const readUntil = async (text: string) => {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        received += decoder.decode(value);
      }
    };
    try {
      await readUntil('event: update'); // initial render
      received = '';
      await publish(command, 'NfseIssuanceStarted');
      await readUntil('Em processamento');
      expect(received).toContain('event: update');
      expect(received).toContain('Robô iniciou a emissão');
    } finally {
      controller.abort();
    }
  });
});
