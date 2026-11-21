# Robô de Emissão

Java 21 + Spring Boot 3 + Spring AMQP + Playwright. Consome comandos `IssueNfse` da fila `robot.issue-nfse` e opera o Portal da Prefeitura com um navegador real. Reporta o andamento e o resultado como eventos em `nfse.events` (ADR 0003).

## Por comando

```text
valida contra contracts/schemas             → estacionado em robot.issue-nfse.dlq se violar o contrato
publica NfseIssuanceStarted (confirmado)
resolve credentialRef → login               (cofre de credenciais; senhas nunca trafegam nas mensagens)
faz login no Portal da Prefeitura
consulta por RPS → encontrou? reutiliza : emite   (ADR 0002)
baixa XML + PDF do DANFSe (mesma sessão)
envia os dois ao armazenamento de objetos   (claim check, ADR 0004)
publica NfseIssued com as referências dos objetos (confirmado)
ack

captcha na página de login                         → resolvido (aritmética simples, resolvível por máquina de propósito)
sessão expirada no meio do fluxo (volta ao /login) → faz login de novo e continua, até 2× por tentativa
página de manutenção (HTTP 200, detectada pelo conteúdo) → transitória
timeout fantasma (emitida, resposta perdida)       → transitória; a retentativa encontra a NFS-e pelo RPS e a reporta
comando reentregue (queda antes do ack)            → encontrado pelo RPS, NfseIssued de novo com o mesmo número
falha de negócio (credencial errada, dados recusados) → NfseIssuanceFailed(business), ack, sem retentativa
falha transitória (HTTP 5xx, timeout, navegador)   → NfseIssuanceAttemptFailed(transient)
    tentativa ≤ 3 → republica em robot.issue-nfse.retry-N com expiração 10s | 1m | 5m e x-attempt+1
                    (volta por dead-letter para robot.issue-nfse quando expira)
    tentativa = 4 → estaciona em robot.issue-nfse.dlq, NfseIssuanceFailed(transient)
    toda republicação é confirmada pelo broker antes do ack da original; AttemptFailed é publicado depois,
    em melhor esforço, e no caminho da DLQ o NfseIssuanceFailed sai antes de estacionar (repeti-lo é seguro)

erro inesperado (por exemplo, sem confirmação do broker) → 3 tentativas em processo (1s, 2s, 4s), depois estaciona na DLQ
```

## Artefatos de falha

Toda tentativa roda sob um trace do Playwright (capturas de tela + snapshots do DOM). Em caso de sucesso, o trace é descartado. Em qualquer falha nas páginas da Prefeitura, de negócio ou transitória, o robô envia ao armazenamento de objetos uma captura de tela da página inteira e o trace:

```text
<issuanceRequestId>/failures/<messageId do comando>/attempt-<n>/screenshot.png
<issuanceRequestId>/failures/<messageId do comando>/attempt-<n>/trace.zip
```

As referências vão em `payload.artifacts` de `NfseIssuanceAttemptFailed` / `NfseIssuanceFailed`. O `messageId` do comando faz parte da chave, então um Reprocessamento (um novo comando, cujas tentativas recomeçam em 1) nunca sobrescreve evidências anteriores. Falhas antes de o navegador ter uma página (`credentialRef` desconhecida, navegador que não inicia) e envios do claim check depois da emissão não trazem artefatos: não há página para mostrar. Quando as retentativas acabam, `NfseIssuanceFailed` repete as referências da última tentativa. O registro é de melhor esforço: se um envio falhar, o evento sai sem aquela referência e o resultado da tentativa não muda. Abra um trace com `npx playwright show-trace trace.zip` ou em https://trace.playwright.dev.

Cada passo de página espera por um resultado explícito (o menu de usuário logado ou um alerta, o número da NFS-e ou um alerta), nunca apenas pelo carregamento da página. Toda navegação confere o status HTTP.

Toda linha de log traz o hostname da instância, a thread e o correlation ID do comando.

## Concorrência e escala

- Cada instância roda `ROBOT_CONCURRENCY` (padrão 3) threads consumidoras, cada uma com um comando sem ack por vez (prefetch 1).
- O Playwright para Java **não é thread-safe**: seus objetos precisam ficar na thread que os criou. Por isso cada thread consumidora tem seu próprio Playwright + Browser (`BrowserPool`), e cada Solicitação ganha um `BrowserContext` novo e isolado. Cookies e sessões nunca passam de uma emissão concorrente para outra.
- Escale horizontalmente com `docker compose up -d --scale invoice-robot=3`. As instâncias competem pela fila `robot.issue-nfse`, e cada uma expõe `/actuator/health/liveness`, usado pelo compose como healthcheck.

## Configuração

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | Broker |
| `CITY_HALL_URL` | `http://localhost:3001` | Portal da Prefeitura |
| `CREDENTIALS_FILE` | `../../infra/robot/credentials.json` | Cofre de segredos: credentialRef → login na Prefeitura |
| `HEADLESS` | `true` | Use `false` localmente para ver o navegador |
| `RETRY_DELAYS` | `10s,1m,5m` | Backoff por retentativa (no máximo 3, uma por fila de retentativa) |
| `ROBOT_CONCURRENCY` | `3` | Emissões simultâneas por instância |
| `S3_ENDPOINT` / `S3_BUCKET` | `http://localhost:8333` / `nfse-documents` | Armazenamento de objetos para os documentos |

## Testes

`mvn test` (Java 21, requer Docker) executa os testes de fronteira da seam 1. O Portal da Prefeitura é construído a partir do seu Dockerfile, junto com Postgres e RabbitMQ (com as definições reais), e os testes verificam os eventos publicados e a NFS-e na Prefeitura.
