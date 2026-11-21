# Portal da Prefeitura stays outside the messaging system

The Portal da Prefeitura simulates a third-party legacy system that exposes only a web UI: no API, no queue, no webhooks. It never connects to RabbitMQ and knows nothing about the Portal da Contabilidade. This is the reason the Robô de Emissão exists, so giving the portal a shortcut integration "because we own it" would defeat the purpose of the POC.

## Consequences

- All integration with the Prefeitura goes through browser automation, and its failures (slowness, expired sessions, maintenance pages served with HTTP 200, a falsely solvable captcha) are simulated on purpose through a chaos mode page.
- The Prefeitura's database is private to it. The robot learns state only by reading pages, including the "query NFS-e by RPS" page.
