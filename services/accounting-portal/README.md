# Portal da Contabilidade

Onde o Escritório Contábil cria Solicitações de Emissão e as envia ao Robô de Emissão. Não há login (POC).

## Fluxo

1. **Nova Solicitação**: o formulário abre preenchido com dados de exemplo válidos, prontos para salvar. Escolha um Prestador e um Serviço do seu Catálogo de Serviços e informe o Tomador, o valor, a Competência e a Discriminação. A Solicitação é salva como **Rascunho** com o próximo número de RPS do Prestador. A Competência deve estar no formato `AAAA-MM`; `MM/AAAA` também é aceito e convertido.
2. **Emitir**: em uma única transação no banco, registra a intenção e grava um comando `IssueNfse` no outbox. Enquanto não é publicado, o status mostra "Rascunho (envio pendente)".
3. **Relay do outbox**: consulta as linhas pendentes, publica-as na fila `robot.issue-nfse` com publisher confirms e marca a Solicitação como **Enviada**. Se o broker estiver fora do ar, as linhas continuam pendentes e são tentadas de novo.
4. **Acompanhamento de status**: consome os eventos do robô em `accounting.nfse-events` (ligada a `nfse.events`), validados contra `contracts/schemas`:

   | Evento | Mudança de status (só avança) | Linha do tempo |
   | --- | --- | --- |
   | `NfseIssuanceStarted` | Rascunho/Enviada → **Em processamento** | ✓ |
   | `NfseIssuanceAttemptFailed` | nenhuma | ✓ com o motivo |
   | `NfseIssued` | qualquer um exceto Emitida → **Emitida** (+ número, código de verificação, referências dos documentos) | ✓ |
   | `NfseIssuanceFailed` | Rascunho/Enviada/Em processamento → **Falhou** (+ motivo) | ✓ |

   Uma Solicitação Emitida tem links para o XML e o DANFSe por URLs pré-assinadas do armazenamento de objetos (15 min), assinadas para `S3_PUBLIC_ENDPOINT`. Da mesma forma, cada tentativa com falha na linha do tempo tem links para a captura de tela e o trace do Playwright registrados pelo robô.
5. **Reprocessamento**: uma Solicitação com status **Falhou** oferece *Reprocessar*. O botão grava um novo `IssueNfse` (novo `messageId`, **RPS original**) no outbox e registra "Reprocessamento solicitado" na linha do tempo. Em seguida, o relay devolve a Solicitação para **Enviada**. Como o RPS é reutilizado, a consulta por RPS do robô impede uma segunda NFS-e (ADR 0002). Cliques simultâneos geram um único comando, e Solicitações que não falharam respondem 409.

   Cada evento é aplicado uma única vez (um inbox indexado por `messageId`). Um evento que faria o status retroceder ainda é registrado na linha do tempo. A página de detalhe se atualiza ao vivo por server-sent events (HTMX SSE), com notificações em processo para uma única instância.

## Prestadores pré-cadastrados

| Prestador | CNPJ | Referência de credencial | Serviços |
| --- | --- | --- | --- |
| ACME Tecnologia Ltda | 11.111.111/0001-11 | `prestador-acme` | 01.07, 01.05 |
| Beta Consultoria ME | 22.333.444/0001-55 | `prestador-beta` | 17.01, 17.19 |
| Gama Engenharia S.A. | 33.444.555/0001-66 | `prestador-gama` | 07.02, 07.03 |

## Testes

`npm test` executa os testes de fronteira (requer Docker): criação, envio, validade do `IssueNfse` perante o contrato, indisponibilidade do broker, envio duplo e concorrente, alocação de RPS, validação do catálogo e da Competência, todas as transições de status, links dos artefatos de falha, eventos duplicados e fora de ordem, eventos inválidos e a atualização ao vivo por SSE.

## Execução

`docker compose up accounting-portal` a partir da raiz do repositório; depois abra http://localhost:3000.
