# Portal da Contabilidade

Where the Escritório Contábil creates Solicitações de Emissão and dispatches them to the Robô de Emissão. There is no login (POC).

## Flow

1. **Nova Solicitação**: pick a Prestador and a Serviço from its Catálogo de Serviços, then enter the Tomador, amount, Competência and Discriminação. The Solicitação is saved as **Rascunho** with the Prestador's next RPS number.
2. **Emitir**: in one database transaction, records the intent and writes an `IssueNfse` command to the outbox. While unpublished, the status shows "Rascunho (envio pendente)".
3. **Outbox relay**: polls pending rows, publishes them to the `robot.issue-nfse` queue with publisher confirms, then marks the Solicitação **Enviada**. If the broker is down, rows stay pending and are retried.

## Seeded Prestadores

| Prestador | CNPJ | Credential ref | Serviços |
| --- | --- | --- | --- |
| ACME Tecnologia Ltda | 11.111.111/0001-11 | `prestador-acme` | 01.07, 01.05 |
| Beta Consultoria ME | 22.333.444/0001-55 | `prestador-beta` | 17.01, 17.19 |
| Gama Engenharia S.A. | 33.444.555/0001-66 | `prestador-gama` | 07.02, 07.03 |

## Tests

`npm test` runs the boundary tests (Docker required): create, dispatch, contract validity of `IssueNfse`, broker outage, double dispatch, RPS allocation and catalogue validation.

## Running

`docker compose up accounting-portal` from the repository root, then open http://localhost:3000.
