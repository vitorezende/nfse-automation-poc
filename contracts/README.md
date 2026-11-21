# Message contracts

Source of truth for the messages exchanged between the Portal da Contabilidade and the Robô de Emissão (ADR 0003).

- `asyncapi.yaml`: channels (the `robot.issue-nfse` command queue and the `nfse.events` topic exchange) and operations.
- `schemas/`: JSON Schema (draft 2020-12) for the standard envelope and each message type. Every service validates incoming messages against these files.
- `examples/`: one valid example per message type.

Run `npm install && npm test` to validate the examples and the AsyncAPI document.
