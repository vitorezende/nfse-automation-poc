# RPS number is the idempotency key, checked before every issuance

The Robô de Emissão can issue an NFS-e and then crash or time out before confirming it (the "phantom timeout"). A blind retry would then issue a duplicate. Instead of inventing a technical idempotency key, we use the domain's own mechanism: the Portal da Contabilidade assigns an RPS number when it creates the Solicitação de Emissão, and the Prefeitura accepts each RPS at most once. Before issuing, the robot queries the Prefeitura by RPS. If an NFS-e already exists, the robot downloads its documents and reports success instead of issuing again.

## Consequences

- Automatic retries and manual Reprocessamento both reuse the original RPS, so neither can produce a second NFS-e.
- The fake Prefeitura must enforce RPS uniqueness and offer a lookup by RPS.
