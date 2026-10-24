# CLAUDE.md

Este arquivo orienta o Claude Code (claude.ai/code) ao trabalhar neste serviço.

## Visão geral

O `marketplace-gateway` é um serviço do monorepo "omni-market": isola o sistema das APIs de Amazon, Mercado Livre e Shopee (simuladas no WireMock). Ele publica os produtos aprovados como anúncios, recebe os pedidos dos marketplaces e sincroniza estoque. É um app Node.js 22 / TypeScript / Express 5 (saída CommonJS) com OpenTelemetry para traces, métricas e logs, e espelha a arquitetura do `order-service`.

O desenho da integração está nos ADRs `../docs/adr/0008` a `0011`: anti-corruption layer com um adapter por marketplace atrás da porta `MarketplacePort` (0008), resiliência com timeout, retry, circuit breaker e idempotência (0009), pedidos por polling (0010) e dados do produto por consulta ao catalog (0011). Os contratos de eventos estão em `../docs/eventos.md`.

O bootstrap (#17, spec em `../docs/specs/marketplace-gateway/bootstrap/spec.md`) entrega o esqueleto: configuração, app HTTP com health check, Postgres com migrations, observabilidade e publicação de eventos pelo outbox. Ainda não há domínio: os anúncios (#21), os pedidos (#22) e a sincronização de estoque (#33) entram nos PRs seguintes.

A infraestrutura compartilhada e as convenções do monorepo estão em `../CLAUDE.md`.

## Comandos

Rode os comandos a partir deste diretório:

```bash
make -C .. up-infra                       # infra sem as aplicações: marketplace-db (:5436), Kafka, WireMock (:8089), coletor OTel (:4318), Grafana (:3000) etc.
npm run dev                               # tsx watch, com a instrumentação pré-carregada
npm run build && npm start                # compila para dist/ e executa
npm test                                  # todos os testes (unitários e de integração); o Docker precisa estar rodando
npm run test:unit                         # só os unitários: sem container, em poucos segundos
npm run test:integration                  # só os de integração (*.int.spec.ts), com um Postgres de Testcontainers
npx jest src/infra/http                   # uma pasta
npx jest -t 'answers 200 UP'              # testes pelo nome
npm run typecheck                         # tsc sobre src, incluindo os specs
```

Migrations (Knex, `src/infra/persistence/migrations/`):

```bash
npm run migrate                           # aplica as migrations pendentes a partir de src/ (tsx)
npm run migrate:status                    # lista as aplicadas e as pendentes
npm run migrate:rollback                  # desfaz o último lote
npm run migrate:make -- create_listings   # novo arquivo de migration com timestamp
npm run migrate:deploy                    # aplica a partir de dist/ (usado pela imagem Docker ao subir)
```

- `ExtensionlessMigrationSource` grava as migrations sem a extensão, então um banco migrado a partir de `src/` e de `dist/` continua consistente. Todo executor (`migrate.ts`, `knexfile.ts`, specs) deve usar `createMigrationSource()`.
- A imagem Docker roda `migrate:deploy` antes de iniciar o app, e uma migration que falha sai com código 1, então o app nunca sobe. Escreva migrations compatíveis com a versão anterior (expandir e contrair).
- Tabelas existentes: `outbox` (ADR-0002, lida pelo relay) e `processed_events` (inbox: uma linha por id de evento consumido, para os consumers de #21, #22 e #33).
- A coluna `outbox.aggregate_id` é `text`, e não `uuid` como nos outros serviços: ela vira a chave da mensagem Kafka, que em `marketplace.order.received.v1` é `<marketplace>:<externalOrderId>`.

Configuração por variáveis de ambiente (veja `.env.example`; o `.env` é carregado se existir): `PORT` (8087), `LOG_LEVEL` (`info`), `OTEL_SERVICE_NAME` (`marketplace-gateway`), `OTEL_COLLECTOR_URL` (`http://localhost:4318`), `DATABASE_URL` (`postgresql://marketplace:marketplace@localhost:5436/marketplace`) e `KAFKA_BROKERS` (lista separada por vírgula, `localhost:9092`; dentro de um container do compose, `kafka:19092`). Um `PORT` inválido interrompe o serviço na partida.

O TypeScript fica preso na versão 6.x porque o `ts-jest` não suporta o TypeScript 7.

## Arquitetura: Hexagonal (Ports and Adapters)

O `core` é o hexágono: regras de negócio mais as portas que definem como o mundo externo conversa com ele. O `infra` guarda os adapters que ligam a tecnologia a essas portas.

```
src/
  core/                          o hexágono, sem framework
    <agregado>/                  ex.: listing/ (#21), order/ (#22)
      model/                     entidades, value objects, eventos de domínio e erros (se validam sozinhos)
      port/in/                   portas de entrada: interfaces chamadas pelo mundo externo
      port/out/                  portas de saída: o que o core precisa (repositórios, MarketplacePort, catalog)
      <agregado>.facade.ts       serviço de aplicação: implementa port/in, depende só de port/out
    shared/domain/               classes base (Entity, AggregateRoot, DomainEvent, DomainError, Id)
    architecture.spec.ts         falha se o core importar framework, driver ou infra
  infra/                         adapters, agrupados por tecnologia
    http/                        app Express (createApp), error handler, rota de health
    persistence/                 conexão Knex, migrations, migrator, probe do banco, repositório do outbox
    messaging/                   producer Kafka, relay do outbox, tipo do mapper de eventos de integração
    config/                      leitura do ambiente (loadConfig)
    observability/               bootstrap do SDK OpenTelemetry, logger, contexto de trace
    testing/                     apoio aos testes: Postgres compartilhado e banco por spec (fora do build)
  main.ts                        raiz de composição: abre recursos, inicia o relay e o servidor
```

- As dependências apontam só para dentro. O `core` nunca importa Express, Knex, pg, pino, kafkajs, OpenTelemetry nem nada de `infra`; o `src/core/architecture.spec.ts` garante.
- As facades são classes simples que implementam interfaces de `port/in` e recebem as dependências de `port/out` pelo construtor. Os controllers dependem de `port/in`, não da facade.
- O core lança os próprios erros de domínio, nunca um `Error` solto. Cada um estende uma categoria de `core/shared/domain/domain.error.ts`: `ValidationError` → 422, `NotFoundError` → 404, `ConflictError` → 409, em `application/problem+json`. Erros 4xx do Express mantêm o status; qualquer outro vira 500 sem a mensagem.
- Erros 4xx são logados só com status, tipo, método e caminho: os erros do body-parser carregam o corpo cru da requisição, e a mensagem de um `SyntaxError` de JSON pode citar um pedaço dele.
- Um agregado novo é ligado em `infra/<agregado>.factory.ts` e chamado de `main.ts`, para que os testes montem o app com fakes por `createApp`.
- Os testes ficam ao lado do código (`foo.ts` → `foo.spec.ts`). Facades são testadas com fakes em memória de `port/out`, rotas com supertest e dependências falsas, e persistência e mensageria contra um Postgres real (o outbox precisa de `jsonb` e `SKIP LOCKED`).
- Siga o Clean Code: nomes pequenos que revelam a intenção, responsabilidade única, sem comentários que repetem o código.

## Testes

- Specs sem container são `*.spec.ts` (projeto Jest `unit`): fakes, supertest, timers falsos. Specs que precisam do Docker são `*.int.spec.ts` (projeto `integration`).
- O projeto `integration` sobe **um** Postgres (`postgres:18-alpine`, dados em tmpfs, `fsync=off`) para a execução inteira, em `src/infra/testing/global-setup.ts`, e cada arquivo de spec cria o próprio banco com `createTestDatabase()`. O container só sobe quando um spec de integração é selecionado: `npm run test:unit` e `npx jest <spec unitário>` não precisam do Docker.
- Com `TEST_POSTGRES_URI=postgres://usuario:senha@host:porta/banco` o projeto usa esse servidor e não sobe container (útil quando a máquina está lenta, ou em CI com um serviço de Postgres).
- Em máquina lenta, a primeira subida do container pode levar alguns minutos. Se um teste falhar por tempo de container, repita só ele antes de procurar um defeito.

## Health check

`GET /health` roda `select 1` no Postgres com timeout de 2 s: `200 {"status":"UP"}`, ou `503 {"status":"DOWN"}` com um log `warn`. Não verifica o Kafka: uma queda do Kafka só atrasa a publicação, porque os eventos esperam no outbox. O Dockerfile e o compose usam o endpoint como healthcheck.

## Observabilidade

- `infra/observability/instrumentation.ts` inicia o `NodeSDK` e precisa rodar antes de qualquer outro módulo. `dev` e `start` o carregam com `--require`; nunca o importe do código da aplicação.
- Em `SIGTERM`/`SIGINT` ele só descarrega o SDK. Quem encerra o processo é o `main.ts`: fecha o servidor, espera a rodada do relay, desconecta o producer, destrói o pool e sai com código 0.
- Logs: use o `Logger` do pino. O `instrumentation-pino` adiciona `trace_id`/`span_id` e envia cada registro ao coletor. Os avisos do Knex também passam pelo pino (`createDatabaseConnection`), então toda linha é JSON.
- Métricas e spans customizados: use `@opentelemetry/api` dentro de `infra`, nunca no `core`.

## Mensageria (Kafka)

Os eventos de domínio chegam ao Kafka por um outbox transacional (`../docs/adr/0002-outbox-para-eventos-do-catalog-service.md`):

- Os agregados estendem `AggregateRoot` e usam `record(...)` para registrar eventos de domínio. O repositório salva o agregado e acrescenta `pullDomainEvents()` com `KnexOutboxRepository.append(tx, aggregateType, events)` na mesma transação.
- O `KnexOutboxRepository` guarda o evento de integração, não o de domínio. Todo evento que sai do serviço precisa de um mapeamento em `infra/messaging/<agregado>.integration-events.ts` (tipo público e versionado, como `marketplace.listing.published.v1`); o mapper lança erro para um evento sem mapeamento, e a transação não grava nada.
- O `OutboxRelay` roda a cada 1000 ms (uma rodada por vez), pega até 100 linhas pendentes em ordem de `sequence` com `FOR UPDATE SKIP LOCKED`, publica cada uma no tópico com o nome do tipo, com `aggregate_id` como chave e os headers CloudEvents `ce_*` (`ce_source=/marketplace-gateway`), e então preenche `published_at`. Um envio que falha deixa as linhas pendentes para a rodada seguinte. A entrega é at-least-once: os consumidores deduplicam por `ce_id`.
- O relay envia cada evento dentro do trace que o registrou (a coluna `headers` do outbox guarda o contexto W3C).
- O producer é idempotente, com uma requisição em voo e 5 tentativas. O serviço não sobe sem o Kafka (`producer.connect()` roda antes de `listen`).
- Todo tópico novo, publicado ou consumido, entra em `../docker/kafka/create-topics.sh`. Os tópicos do gateway já estão lá: `marketplace.order.received.v1`, `marketplace.listing.published.v1`, `marketplace.listing.failed.v1` e as DLQs `marketplace.catalog-product.dlq` e `marketplace.order-cancelled.dlq`.
- Os consumers (a partir de #21) são adapters de entrada: validam a mensagem com zod, usam `processed_events` para pular reentregas, mandam para a DLQ a mensagem que nunca vai dar certo e relançam qualquer outra coisa para o Kafka reentregar.
