# Portal da Contabilidade

Where the Escritório Contábil creates Solicitações de Emissão and dispatches them to the Robô de Emissão. There is no login (POC).

## Flow

1. **Nova Solicitação**: pick a Prestador and a Serviço from its Catálogo de Serviços, then enter the Tomador, amount, Competência and Discriminação. The Solicitação is saved as **Rascunho** with the Prestador's next RPS number.
2. **Emitir**: in one database transaction, records the intent and writes an `IssueNfse` command to the outbox. While unpublished, the status shows "Rascunho (envio pendente)".
3. **Outbox relay**: polls pending rows, publishes them to the `robot.issue-nfse` queue with publisher confirms, then marks the Solicitação **Enviada**. If the broker is down, rows stay pending and are retried.
4. **Status tracking**: consumes the robot's events from `accounting.nfse-events` (bound to `nfse.events`), validated against `contracts/schemas`:

   | Event | Status change (forward only) | Timeline |
   | --- | --- | --- |
   | `NfseIssuanceStarted` | Rascunho/Enviada → **Em processamento** | ✓ |
   | `NfseIssuanceAttemptFailed` | none | ✓ with reason |
   | `NfseIssued` | anything but Emitida → **Emitida** (+ number, verification code) | ✓ |
   | `NfseIssuanceFailed` | Rascunho/Enviada/Em processamento → **Falhou** (+ reason) | ✓ |

   Each event is applied once (an inbox keyed on `messageId`). An event that would move the status backwards is still recorded on the timeline. The detail page updates live through server-sent events (HTMX SSE), using single-instance in-process notifications.

## Seeded Prestadores

| Prestador | CNPJ | Credential ref | Serviços |
| --- | --- | --- | --- |
| ACME Tecnologia Ltda | 11.111.111/0001-11 | `prestador-acme` | 01.07, 01.05 |
| Beta Consultoria ME | 22.333.444/0001-55 | `prestador-beta` | 17.01, 17.19 |
| Gama Engenharia S.A. | 33.444.555/0001-66 | `prestador-gama` | 07.02, 07.03 |

## Tests

`npm test` runs the boundary tests (Docker required): create, dispatch, contract validity of `IssueNfse`, broker outage, double/concurrent dispatch, RPS allocation, catalogue validation, every status transition, duplicate and out-of-order events, invalid events, and the live SSE update.

## Running

`docker compose up accounting-portal` from the repository root, then open http://localhost:3000.
