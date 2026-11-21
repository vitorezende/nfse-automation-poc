# Claim check on MinIO for NFS-e documents

The XML and the PDF (DANFSe) produced for each NFS-e are not sent inside messages. The Robô de Emissão uploads them to MinIO (S3-compatible), and the `NfseIssued` event carries only their object references. The Portal da Contabilidade serves them to users through presigned URLs. This keeps messages small and the broker healthy. It also avoids a design where the Portal da Contabilidade has to log in to the Prefeitura to fetch documents.

## Consequences

- The robot acknowledges a command only after both uploads succeed and the result event is publisher-confirmed. A crash in between causes a redelivery, which the RPS check makes safe (see ADR 0002).
