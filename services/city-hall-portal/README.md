# Portal da Prefeitura (fictício)

Um portal de NFS-e só web, com aparência propositalmente legada, usado como alvo do Robô de Emissão. Não tem API e nunca se comunica com o RabbitMQ (ADR 0001). Todos os dados são fictícios, e todas as páginas avisam isso.

## Páginas

| Caminho | Finalidade |
| --- | --- |
| `/login` | Login com usuário e senha por Prestador (sessão em cookie `PREFSESSID`, 30 min) |
| `/` | Últimas NFS-e do Prestador logado |
| `/nfse/emitir` | Formulário de emissão (post de formulário clássico). Recusa RPS duplicado por Prestador |
| `/nfse/consulta?rpsNumber=&rpsSeries=` | Consulta de NFS-e por RPS |
| `/nfse/:id` | Detalhe da NFS-e (número, código de verificação, ISS) |
| `/nfse/:id/xml`, `/nfse/:id/pdf` | XML simplificado e sem assinatura; PDF do DANFSe sempre com a marca d'água "SIMULAÇÃO – SEM VALOR FISCAL" |
| `/admin/chaos` | Modo caos (sem login), aplicado na hora: latência aleatória, HTTP 500 na emissão, expiração de sessão na emissão (nunca duas vezes seguidas para o mesmo Prestador), timeout fantasma na emissão (a NFS-e é emitida, mas a resposta nunca chega), manutenção programada servida com HTTP 200 e captcha aritmético no login |

## Prestadores pré-cadastrados

Precisam coincidir com o cofre de credenciais do robô e com os dados iniciais do Portal da Contabilidade.

| Prestador | CNPJ | Usuário | Senha |
| --- | --- | --- | --- |
| ACME Tecnologia Ltda | 11.111.111/0001-11 | `acme` | `acme-pass` |
| Beta Consultoria ME | 22.333.444/0001-55 | `beta` | `beta-pass` |
| Gama Engenharia S.A. | 33.444.555/0001-66 | `gama` | `gama-pass` |

## Execução local

```bash
cp .env.example .env            # DATABASE_URL do Postgres do compose
npm install
npx prisma migrate deploy
npm run build && npm run seed
npm run start:prod              # http://localhost:3001
```

Ou execute `docker compose up city-hall-portal` a partir da raiz do repositório.
