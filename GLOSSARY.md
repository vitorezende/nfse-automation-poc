# POC de Automação de NFS-e

Simula um escritório de contabilidade que solicita notas fiscais de serviço (NFS-e) em nome dos seus clientes, emitidas por um robô em um portal de prefeitura fictício. Todos os dados são fictícios; nenhuma nota real é emitida.

No código, os termos de domínio sem bom equivalente em inglês (Prestador, Tomador, NFS-e, RPS) ficam sem tradução; os termos genéricos ficam em inglês.

## Partes

**Escritório Contábil**:
O escritório de contabilidade que opera o Portal da Contabilidade e solicita notas em nome dos seus clientes.
_Evitar_: Contabilidade (como parte), contador

**Prestador**:
A empresa que prestou o serviço e é, legalmente, a emitente da NFS-e; cliente do Escritório Contábil.
_Evitar_: Emitente, empresa, cliente

**Tomador**:
Quem recebeu o serviço do Prestador, identificado pelo CNPJ.
_Evitar_: Cliente, customer, destinatário

**Prefeitura**:
O município cujo portal web é o único canal para emitir uma NFS-e.
_Evitar_: Município (como sistema), governo

## Sistemas

**Portal da Contabilidade**:
O sistema do Escritório Contábil onde as Solicitações de Emissão são criadas e os documentos resultantes ficam guardados.
_Evitar_: Accounting app, backoffice

**Portal da Prefeitura**:
O portal só web da Prefeitura, que simula um sistema legado de terceiros sem API.
_Evitar_: API da Prefeitura, sistema municipal

**Robô de Emissão**:
A automação que opera o Portal da Prefeitura por um navegador em nome de um Prestador.
_Evitar_: Bot, scraper, serviço Playwright

## Faturamento

**Solicitação de Emissão** (no código: `IssuanceRequest`):
Um pedido, criado no Portal da Contabilidade, para emitir uma NFS-e para um Prestador, Tomador, serviço e valor.
_Evitar_: Pedido, job, task, order

**RPS** (Recibo Provisório de Serviços):
O número sequencial de recibo do próprio Prestador para uma Solicitação de Emissão; a Prefeitura aceita cada RPS no máximo uma vez, o que faz dele a identidade que impede NFS-e duplicadas.
_Evitar_: Request ID, chave de idempotência (como termo de domínio)

**NFS-e**:
Nota fiscal de serviço emitida pela Prefeitura, identificada pelo número e pelo código de verificação.
_Evitar_: NF-e, NFe, nota (NF-e é a nota estadual de mercadorias, outro documento)

**Serviço**:
Um item do Catálogo de Serviços de um Prestador: código do serviço, descrição e alíquota de ISS.
_Evitar_: Produto, item

**Catálogo de Serviços**:
O conjunto de Serviços que um Prestador está habilitado a prestar, pré-configurado no Portal da Contabilidade.
_Evitar_: Lista de serviços, parametrização

**Competência**:
O mês/ano em que o serviço foi prestado, que determina o período de apuração da NFS-e.
_Evitar_: Data de emissão, período

**Discriminação**:
A descrição em texto livre do serviço prestado, impressa na NFS-e.
_Evitar_: Observação, descrição (sozinha)

**DANFSe**:
A representação em PDF, para impressão, de uma NFS-e; nesta POC sempre com a marca d'água de simulação sem valor fiscal.
_Evitar_: Nota em PDF, boleto

**Reprocessamento**:
Reenviar uma Solicitação de Emissão que falhou com o seu RPS original, de modo que ela nunca gere uma segunda NFS-e.
_Evitar_: Retry (reservado às retentativas automáticas), reenvio
