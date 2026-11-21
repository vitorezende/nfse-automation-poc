// Seam 3: end-to-end smoke test against the full docker compose stack.
// Starts the stack, creates and dispatches a Solicitação in the Portal da Contabilidade,
// waits for Emitida, then cross-checks the Portal da Prefeitura and the services' logs.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ACCOUNTING = process.env.ACCOUNTING_URL ?? 'http://localhost:3000';
const CITY_HALL = process.env.CITY_HALL_URL ?? 'http://localhost:3001';

const compose = (args) => execSync(`docker compose ${args}`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const field = (html, name) => html.match(new RegExp(`data-field="${name}"[^>]*>([^<]*)<`))?.[1].trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function form(url, data, headers = {}) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(data),
  });
}

before(() => {
  if (process.env.E2E_SKIP_COMPOSE_UP !== '1') compose('up -d --build --wait');
});

test('a Solicitação dispatched in the Portal da Contabilidade ends Emitida with the NFS-e issued at the Prefeitura', async () => {
  const tomadorName = `Tomador E2E ${Date.now()}`;
  const created = await form(`${ACCOUNTING}/solicitacoes`, {
    prestadorCnpj: '22.333.444/0001-55',
    servicoCode: '17.01',
    tomadorCnpj: '99.888.777/0001-66',
    tomadorName,
    amount: '4321.00',
    competencia: '2026-11',
    discriminacao: 'Consultoria (teste end-to-end)',
  });
  assert.equal(created.status, 302);
  const location = new URL(created.headers.get('location'), ACCOUNTING).href;
  assert.equal((await form(`${location}/emitir`, {})).status, 302);

  let page = '';
  for (let i = 0; i < 90 && field(page, 'status') !== 'Emitida'; i++) {
    await sleep(1_000);
    page = await (await fetch(location)).text();
    assert.notEqual(field(page, 'status'), 'Falhou', `issuance failed: ${field(page, 'failureReason')}`);
  }
  assert.equal(field(page, 'status'), 'Emitida');
  const nfseNumber = field(page, 'nfseNumber');
  const [rpsNumber, rpsSeries] = field(page, 'rps').split(' / ');
  const correlationId = field(page, 'correlationId');
  assert.match(nfseNumber, /^\d{10}$/);

  // The same NFS-e is visible at the Prefeitura, looked up by RPS as the Prestador.
  const login = await form(`${CITY_HALL}/login`, { username: 'beta', password: 'beta-pass' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const lookup = await (await fetch(`${CITY_HALL}/nfse/consulta?rpsNumber=${rpsNumber}&rpsSeries=${rpsSeries}`, {
    headers: { cookie },
  })).text();
  assert.ok(lookup.includes(`>${nfseNumber}<`), `NFS-e ${nfseNumber} not found at the Prefeitura for RPS ${rpsNumber}/${rpsSeries}`);

  // One correlation ID can be followed through both services' logs.
  assert.ok(compose('logs accounting-portal').includes(correlationId), 'correlation ID missing from accounting-portal logs');
  assert.ok(compose('logs invoice-robot').includes(correlationId), 'correlation ID missing from invoice-robot logs');
});
