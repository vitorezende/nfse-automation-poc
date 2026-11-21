# Claim check on S3-compatible object storage for NFS-e documents

The XML and the PDF (DANFSe) produced for each NFS-e are not sent inside messages. The Robô de Emissão uploads them to S3-compatible object storage, and the `NfseIssued` event carries only their object references (bucket and key). The Portal da Contabilidade serves them to users through presigned URLs. This keeps messages small and the broker healthy. It also avoids a design where the Portal da Contabilidade has to log in to the Prefeitura to fetch documents.

## Consequences

- The robot acknowledges a command only after both uploads succeed and the result event is publisher-confirmed. A crash in between causes a redelivery, which the RPS check makes safe (see ADR 0002).
- Services talk only to the S3 API, so the storage product can be swapped by changing the compose file. The original choice was MinIO, but its community container images are no longer distributed (the Docker Hub and quay.io pulls are denied), so the POC runs SeaweedFS instead. Specs and tickets that say "MinIO" mean this S3-compatible store.
