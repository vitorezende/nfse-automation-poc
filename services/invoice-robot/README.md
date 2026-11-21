# Robô de Emissão

Java 21 + Spring Boot 3 + Spring AMQP + Playwright. It consumes `IssueNfse` commands from `robot.issue-nfse` and drives the Portal da Prefeitura with a real browser. It reports progress and outcome as events on `nfse.events` (ADR 0003).

## Per command

```text
validate against contracts/schemas          → reject (no requeue) on violation
publish NfseIssuanceStarted (confirmed)
resolve credentialRef → login               (credential store; passwords never travel in messages)
log in to the Portal da Prefeitura
query by RPS → found? reuse it : issue it   (ADR 0002)
publish NfseIssued (confirmed)
ack

any failure after Started                   → publish NfseIssuanceFailed (business | transient), ack
```

Each page step waits for an explicit outcome (the logged-in menu or an alert, the NFS-e number or an alert), never for a bare load state. Automatic retries and the DLQ come with #9.

Every log line carries the command's correlation ID.

## Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | Broker |
| `CITY_HALL_URL` | `http://localhost:3001` | Portal da Prefeitura |
| `CREDENTIALS_FILE` | `../../infra/robot/credentials.json` | Secret store: credentialRef → Prefeitura login |
| `HEADLESS` | `true` | Set `false` locally to watch the browser |

## Tests

`mvn test` (Java 21, Docker required) runs the seam 1 boundary tests. The Portal da Prefeitura is built from its Dockerfile, alongside Postgres and RabbitMQ (with the real definitions), and the test asserts on the published events and on the NFS-e at the Prefeitura.
