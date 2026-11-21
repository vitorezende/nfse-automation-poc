# NFS-e Automation POC

Simulates an accounting firm requesting service invoices (NFS-e) on behalf of its clients, issued by a robot on a fake city hall portal. All data is fictitious; no real invoice is ever issued.

Domain terms with no good English equivalent (Prestador, Tomador, NFS-e, RPS) are kept untranslated in code; generic terms are in English.

## Parties

**Escritório Contábil**:
The accounting firm that operates the Portal da Contabilidade and requests invoices on behalf of its clients.
_Avoid_: Contabilidade (as a party), accountant

**Prestador**:
The company that provided the service and is legally the issuer of the NFS-e; a client of the Escritório Contábil.
_Avoid_: Emitente, empresa, cliente

**Tomador**:
The customer who received the service from the Prestador, identified by CNPJ.
_Avoid_: Cliente, customer, destinatário

**Prefeitura**:
The city hall whose web portal is the only channel for issuing an NFS-e.
_Avoid_: Município (as a system), governo

## Systems

**Portal da Contabilidade**:
The Escritório Contábil's system where Solicitações de Emissão are created and their resulting documents are stored.
_Avoid_: Accounting app, backoffice

**Portal da Prefeitura**:
The Prefeitura's web-only portal, simulating a third-party legacy system with no API.
_Avoid_: Prefeitura API, municipal system

**Robô de Emissão**:
The automation that operates the Portal da Prefeitura through a browser on behalf of a Prestador.
_Avoid_: Bot, scraper, Playwright service

## Invoicing

**Solicitação de Emissão** (code: `IssuanceRequest`):
A request, created in the Portal da Contabilidade, to issue one NFS-e for a given Prestador, Tomador, service and amount.
_Avoid_: Pedido, job, task, order

**RPS** (Recibo Provisório de Serviços):
The Prestador's own sequential receipt number for a Solicitação de Emissão; the Prefeitura accepts each RPS at most once, which makes it the identity that prevents duplicate NFS-e.
_Avoid_: Request ID, idempotency key (as a domain term)

**NFS-e**:
A service invoice issued by the Prefeitura, identified by its number and verification code.
_Avoid_: NF-e, NFe, nota (NF-e is the state-level goods invoice, a different document)

**Serviço**:
An entry in a Prestador's Catálogo de Serviços: service code, description and ISS rate.
_Avoid_: Produto, item

**Catálogo de Serviços**:
The set of Serviços a Prestador is registered to provide, pre-configured in the Portal da Contabilidade.
_Avoid_: Service list, parametrização

**Competência**:
The month/year in which the service was provided, which determines the tax period of the NFS-e.
_Avoid_: Data de emissão, período

**Discriminação**:
The free-text description of the service rendered, printed on the NFS-e.
_Avoid_: Observação, descrição (alone)

**DANFSe**:
The printable PDF representation of an NFS-e; in this POC always watermarked as a simulation with no fiscal value.
_Avoid_: Nota em PDF, boleto

**Reprocessamento**:
Re-dispatching a failed Solicitação de Emissão with its original RPS, so it can never produce a second NFS-e.
_Avoid_: Retry (reserved for automatic retries), reenvio
