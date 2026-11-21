# Commands out, events back, with AsyncAPI contracts between Node and Java

The Portal da Contabilidade sends an `IssueNfse` command to a queue owned by the Robô de Emissão, because exactly one consumer must act on it. The robot reports back through events on a topic exchange (`NfseIssuanceStarted`, `NfseIssuanceAttemptFailed`, `NfseIssued`, `NfseIssuanceFailed`), because any number of consumers may care about the outcome. The services are written in different languages (NestJS and Java/Spring), so the contract lives outside the code: AsyncAPI plus JSON Schema in `contracts/`, with a standard envelope (`messageId`, `correlationId`, `causationId`, `type`, `version`, `occurredAt`, `payload`) and plain JSON bodies.

## Considered Options

- NestJS's built-in RMQ transport was rejected: it wraps payloads in its own `{pattern, data}` envelope and assumes request/reply, which would leak a Node convention into the Java side.
- Protobuf/Avro with a schema registry was rejected as too heavy for a POC.

## Consequences

- Both sides validate incoming messages against the schemas, and delivery is at-least-once. The Portal da Contabilidade therefore deduplicates events by `messageId` and ignores state regressions from out-of-order events.
- Credentials never travel in messages: the command carries only a reference, which the robot resolves from its own secret store.
