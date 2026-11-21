# Robô de Emissão

Java 21 + Spring Boot 3 + Spring AMQP + Playwright. It consumes `IssueNfse` commands from `robot.issue-nfse` and drives the Portal da Prefeitura with a real browser. It reports progress and outcome as events on `nfse.events` (ADR 0003).

## Per command

```text
validate against contracts/schemas          → parked in robot.issue-nfse.dlq on violation
publish NfseIssuanceStarted (confirmed)
resolve credentialRef → login               (credential store; passwords never travel in messages)
log in to the Portal da Prefeitura
query by RPS → found? reuse it : issue it   (ADR 0002)
download XML + DANFSe PDF (same session)
upload both to object storage               (claim check, ADR 0004)
publish NfseIssued with the object refs (confirmed)
ack

captcha on the login page                        → solved (plain arithmetic, by design machine-solvable)
session expired mid-flow (sent back to /login)   → log in again and continue, up to 2× per attempt
maintenance page (HTTP 200, detected by content) → transient
phantom timeout (issued, response lost)          → transient; the retry finds the NFS-e by RPS and reports it
redelivered command (crash before ack)           → found by RPS, NfseIssued again with the same number
business failure (bad credentials, data refused) → NfseIssuanceFailed(business), ack, no retry
transient failure (HTTP 5xx, timeout, browser)   → NfseIssuanceAttemptFailed(transient)
    attempt ≤ 3 → republish to robot.issue-nfse.retry-N with expiration 10s | 1m | 5m and x-attempt+1
                  (dead-lettered back to robot.issue-nfse when it expires)
    attempt = 4 → park in robot.issue-nfse.dlq, NfseIssuanceFailed(transient)
    every republish is broker-confirmed before the original is acked; AttemptFailed is best effort after it,
    and on the DLQ path NfseIssuanceFailed is published before parking (a failure there is safe to repeat)

unexpected error (e.g. no broker confirm)        → 3 in-process tries (1s, 2s, 4s), then parked in the DLQ
```

## Failure artifacts

Every attempt runs under a Playwright trace (screenshots + DOM snapshots). On success the trace is discarded. On any failure on the Prefeitura's pages, business or transient, the robot uploads a full-page screenshot and the trace to object storage:

```text
<issuanceRequestId>/failures/<command messageId>/attempt-<n>/screenshot.png
<issuanceRequestId>/failures/<command messageId>/attempt-<n>/trace.zip
```

The references travel in `payload.artifacts` of `NfseIssuanceAttemptFailed` / `NfseIssuanceFailed`. The command's `messageId` is part of the key, so a Reprocessamento (a new command whose attempts restart at 1) never overwrites earlier evidence. Recording is best effort: if an upload fails, the event goes out without that reference and the attempt's outcome doesn't change. Open a trace with `npx playwright show-trace trace.zip` or at https://trace.playwright.dev.

Each page step waits for an explicit outcome (the logged-in menu or an alert, the NFS-e number or an alert), never for a bare load state. Every navigation checks the HTTP status.

Every log line carries the instance hostname, the thread and the command's correlation ID.

## Concurrency and scaling

- Each instance runs `ROBOT_CONCURRENCY` (default 3) consumer threads, each with one unacked command (prefetch 1).
- Playwright for Java is **not thread-safe**: its objects must stay on the thread that created them. So each consumer thread owns its own Playwright + Browser (`BrowserPool`), and every Solicitação gets a fresh, isolated `BrowserContext`. Cookies and sessions never cross between concurrent issuances.
- Scale out with `docker compose up -d --scale invoice-robot=3`. Instances compete for `robot.issue-nfse`, and each exposes `/actuator/health/liveness`, which compose uses as its healthcheck.

## Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | Broker |
| `CITY_HALL_URL` | `http://localhost:3001` | Portal da Prefeitura |
| `CREDENTIALS_FILE` | `../../infra/robot/credentials.json` | Secret store: credentialRef → Prefeitura login |
| `HEADLESS` | `true` | Set `false` locally to watch the browser |
| `RETRY_DELAYS` | `10s,1m,5m` | Backoff per retry (at most 3, one per retry queue) |
| `ROBOT_CONCURRENCY` | `3` | Concurrent issuances per instance |
| `S3_ENDPOINT` / `S3_BUCKET` | `http://localhost:8333` / `nfse-documents` | Object storage for the documents |

## Tests

`mvn test` (Java 21, Docker required) runs the seam 1 boundary tests. The Portal da Prefeitura is built from its Dockerfile, alongside Postgres and RabbitMQ (with the real definitions), and the test asserts on the published events and on the NFS-e at the Prefeitura.
