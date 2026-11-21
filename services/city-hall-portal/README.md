# Portal da Prefeitura (fake)

A deliberately legacy-looking, web-only NFS-e portal used as the target of the Robô de Emissão. It has no API and never touches RabbitMQ (ADR 0001). All data is fictitious, and every page says so.

## Pages

| Path | Purpose |
| --- | --- |
| `/login` | Username/password login per Prestador (cookie session `PREFSESSID`, 30 min) |
| `/` | Latest NFS-e of the logged-in Prestador |
| `/nfse/emitir` | Issuance form (classic form post). Rejects a duplicate RPS per Prestador |
| `/nfse/consulta?rpsNumber=&rpsSeries=` | Query NFS-e by RPS |
| `/nfse/:id` | NFS-e detail (number, verification code, ISS) |
| `/nfse/:id/xml`, `/nfse/:id/pdf` | Simplified unsigned XML; DANFSe PDF always watermarked "SIMULAÇÃO – SEM VALOR FISCAL" |
| `/admin/chaos` | Chaos mode (no login): random latency and HTTP 500 probability on issuance; applies immediately |

## Seeded Prestadores

These must match the robot's credential store and the Portal da Contabilidade seed.

| Prestador | CNPJ | Username | Password |
| --- | --- | --- | --- |
| ACME Tecnologia Ltda | 11.111.111/0001-11 | `acme` | `acme-pass` |
| Beta Consultoria ME | 22.333.444/0001-55 | `beta` | `beta-pass` |
| Gama Engenharia S.A. | 33.444.555/0001-66 | `gama` | `gama-pass` |

## Running locally

```bash
cp .env.example .env            # DATABASE_URL for the compose Postgres
npm install
npx prisma migrate deploy
npm run build && npm run seed
npm run start:prod              # http://localhost:3001
```

Or run `docker compose up city-hall-portal` from the repository root.
