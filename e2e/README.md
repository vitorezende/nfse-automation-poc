# End-to-end smoke test (seam 3)

Runs against the full `docker compose` stack: creates and dispatches a Solicitação in the Portal da Contabilidade, waits for **Emitida**, finds the same NFS-e at the Portal da Prefeitura by RPS, and checks that one correlation ID appears in both services' logs.

```bash
cd e2e && npm test                       # builds and starts the stack first
E2E_SKIP_COMPOSE_UP=1 npm test           # against an already running stack
```
