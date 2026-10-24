# CLAUDE.md

Este arquivo orienta o Claude Code (claude.ai/code) ao trabalhar neste serviço.

## Visão geral

O `marketplace-gateway` é um serviço do monorepo "omni-market": isola o sistema das APIs de Amazon, Mercado Livre e Shopee (simuladas no WireMock). Ele recebe os pedidos dos marketplaces, cancela pedidos neles, publica os produtos aprovados como anúncios (e expõe o status deles numa API REST para o BFF) e, no próximo PR, sincroniza estoque. É um app Node.js 22 / TypeScript / Express 5 (saída CommonJS) com OpenTelemetry para traces, métricas e logs, e espelha a arquitetura do `order-service`.

O desenho da integração está nos ADRs `../docs/adr/0008` a `0011`: anti-corruption layer com um adapter por marketplace atrás da porta `MarketplacePort` (0008), resiliência com timeout, retry, circuit breaker e idempotência (0009), pedidos por polling (0010) e dados do produto por consulta ao catalog (0011). Os contratos de eventos estão em `../docs/eventos.md`, e os simuladores em `../docs/simuladores-marketplaces.md`.

O que já existe:
- Bootstrap (#17, `../docs/specs/marketplace-gateway/bootstrap/spec.md`): configuração, app HTTP com health check, Postgres com migrations, observabilidade e publicação de eventos pelo outbox.
- Pedidos (#22, `../docs/specs/marketplace-gateway/pedidos/spec.md`): polling dos três marketplaces, publicação de `marketplace.order.received.v1`, cancelamento de pedido por `order.order.cancelled.v1` e a resiliência das chamadas.
- Anúncios (#21, `../docs/specs/marketplace-gateway/anuncios/spec.md`): `catalog.product.approved.v1` publica o anúncio nos três marketplaces, `marketplace.listing.published.v1` e `marketplace.listing.failed.v1` dizem o resultado, e `GET /listings` e `GET /listings/{id}` mostram o status (contrato da #35).

A sincronização de estoque (#33) entra no PR seguinte, na mesma porta e nos mesmos adapters.

A infraestrutura compartilhada e as convenções do monorepo estão em `../CLAUDE.md`.

## Comandos

Rode os comandos a partir deste diretório:

```bash
make -C .. up-infra                       # infra sem as aplicações: marketplace-db (:5436), Kafka, WireMock (:8089), coletor OTel (:4318), Grafana (:3000) etc.
npm run dev                               # tsx watch, com a instrumentação pré-carregada
npm run build && npm start                # compila para dist/ e executa
npm test                                  # todos os testes (unitários e de integração), em série; o Docker precisa estar rodando
npm run test:unit                         # só os unitários: sem container, em poucos segundos
npm run test:integration                  # só os de integração (*.int.spec.ts), com um Postgres e um WireMock de Testcontainers
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
- Tabelas: `outbox` (ADR-0002, lida pelo relay), `processed_events` (inbox: um id de evento consumido por linha), `marketplace_orders` (todo pedido que o gateway tirou de um marketplace; a chave primária `(marketplace, external_order_id)` impede o evento duplicado), `order_cursors` (onde começou o último polling bem-sucedido de cada marketplace) e `listings` (o anúncio de um produto num marketplace; a restrição única `(sku, marketplace)` garante um anúncio por par, e o `id` do anúncio é a `Idempotency-Key` das chamadas).
- A coluna `outbox.aggregate_id` é `text`, e não `uuid` como nos outros serviços: ela vira a chave da mensagem Kafka, que em `marketplace.order.received.v1` é `<marketplace>:<externalOrderId>`.

Configuração por variáveis de ambiente (veja `.env.example`, que lista todas com os padrões; o `.env` é carregado se existir):

- Serviço: `PORT` (8087), `LOG_LEVEL` (`info`), `OTEL_SERVICE_NAME` (`marketplace-gateway`), `OTEL_COLLECTOR_URL` (`http://localhost:4318`), `DATABASE_URL` (`postgresql://marketplace:marketplace@localhost:5436/marketplace`) e `KAFKA_BROKERS` (lista separada por vírgula, `localhost:9092`; dentro de um container do compose, `kafka:19092`).
- Marketplaces: `AMAZON_BASE_URL`, `MERCADO_LIVRE_BASE_URL` e `SHOPEE_BASE_URL` (padrão `http://localhost:8089/<marketplace>`, o WireMock; no compose, `http://wiremock:8080/<marketplace>`), mais `AMAZON_SELLER_ID`, `AMAZON_MARKETPLACE_ID`, `MERCADO_LIVRE_SELLER_ID` e `SHOPEE_SHOP_ID`.
- Catalog: `CATALOG_SERVICE_URL` (`http://localhost:8082`; no compose, `http://catalog-service:8082`) e `CATALOG_TIMEOUT_MS` (3000).
- Resiliência: `MARKETPLACE_TIMEOUT_MS` (3000), `MARKETPLACE_MAX_ATTEMPTS` (3), `MARKETPLACE_BACKOFF_BASE_MS` (200), `MARKETPLACE_BACKOFF_MAX_MS` (2000), `MARKETPLACE_BREAKER_FAILURES` (5) e `MARKETPLACE_BREAKER_COOLDOWN_MS` (30000).
- Polling: `ORDER_POLL_INTERVAL_MS` (5000), `ORDER_POLL_OVERLAP_MS` (60000) e `ORDER_POLL_LOOKBACK_MS` (86400000).
- Tópicos: `CATALOG_PRODUCT_APPROVED_TOPIC` (`catalog.product.approved.v1`), `CATALOG_PRODUCT_DLQ_TOPIC` (`marketplace.catalog-product.dlq`), `ORDER_CANCELLED_TOPIC` (`order.order.cancelled.v1`) e `ORDER_CANCELLED_DLQ_TOPIC` (`marketplace.order-cancelled.dlq`).

Uma variável numérica que não é um inteiro maior que zero, uma URL inválida ou um `PORT` inválido interrompe o serviço na partida (`Invalid <NOME>: <valor>`).

O TypeScript fica preso na versão 6.x porque o `ts-jest` não suporta o TypeScript 7.

## Arquitetura: Hexagonal (Ports and Adapters)

O `core` é o hexágono: regras de negócio mais as portas que definem como o mundo externo conversa com ele. O `infra` guarda os adapters que ligam a tecnologia a essas portas.

```
src/
  core/                          o hexágono, sem framework
    marketplace/                 o que é comum aos marketplaces
      model/                     Marketplace (AMAZON, MERCADO_LIVRE, SHOPEE) e os erros das chamadas (MarketplaceError)
      port/out/                  MarketplacePort, o pedido canônico (CanonicalOrder) e o rascunho do anúncio (ListingDraft)
      marketplace.registry.ts    o adapter de cada marketplace, escolhido pelo nome
    listing/                     os anúncios de um produto nos marketplaces
      model/                     Listing (agregado: PENDING, PUBLISHED ou FAILED), os eventos ListingPublished e ListingFailed, o SKU e os erros
      port/in/                   PublishApprovedProductPort e FindListingsPort
      port/out/                  repositórios de escrita e de leitura dos anúncios e ProductCatalogPort
      listing.facade.ts          implementa as duas portas de entrada
    order/                       os pedidos dos marketplaces
      model/                     MarketplaceOrder (agregado), sua chave e o evento OrderReceived
      port/in/                   ReceiveMarketplaceOrdersPort e CancelMarketplaceOrderPort
      port/out/                  repositório de pedidos e de cursores
      order.facade.ts            implementa as duas portas de entrada
    shared/domain/               classes base (Entity, AggregateRoot, DomainEvent, DomainError, Id)
    architecture.spec.ts         falha se o core importar framework, driver ou infra
  infra/                         adapters, agrupados por tecnologia
    http/                        app Express (createApp), error handler, validação de entrada (zod), rotas de health e de anúncios
    persistence/                 conexão Knex, migrations, repositórios (outbox, pedidos, cursores, inbox, anúncios)
    messaging/                   producer Kafka, relay do outbox, consumers (cancelamentos e produtos aprovados), DLQ, mappers de eventos
    catalog/                     o cliente HTTP do catalog-service (ProductCatalogPort)
    marketplace/                 um adapter por marketplace, o cliente HTTP, o circuit breaker e o decorator de resiliência
    polling/                     laço periódico e os pollers de pedidos (um laço por marketplace)
    config/                      leitura do ambiente (loadConfig)
    observability/               bootstrap do SDK OpenTelemetry, logger, contexto de trace, spans
    testing/                     apoio aos testes: Postgres e WireMock compartilhados, banco por spec (fora do build)
    order.factory.ts             liga a facade de pedidos aos seus adapters
    listing.factory.ts           liga a facade de anúncios aos seus adapters (repositórios, catalog, consumer e controller)
  main.ts                        raiz de composição: abre recursos, inicia o relay, os consumers, os pollers e o servidor
```

- As dependências apontam só para dentro. O `core` nunca importa Express, Knex, pg, pino, kafkajs, OpenTelemetry nem nada de `infra`; o `src/core/architecture.spec.ts` garante.
- As facades são classes simples que implementam interfaces de `port/in` e recebem as dependências de `port/out` pelo construtor. Os controllers dependem de `port/in`, não da facade.
- O core lança os próprios erros de domínio, nunca um `Error` solto. Cada um estende uma categoria de `core/shared/domain/domain.error.ts`: `ValidationError` → 422, `NotFoundError` → 404, `ConflictError` → 409, em `application/problem+json`. Erros 4xx do Express mantêm o status; qualquer outro vira 500 sem a mensagem.
- Erros 4xx são logados só com status, tipo, método e caminho: os erros do body-parser carregam o corpo cru da requisição, e a mensagem de um `SyntaxError` de JSON pode citar um pedaço dele.
- Um agregado novo é ligado em `infra/<agregado>.factory.ts` e chamado de `main.ts`, para que os testes montem o app com fakes.
- Os testes ficam ao lado do código (`foo.ts` → `foo.spec.ts`). Facades são testadas com fakes em memória de `port/out`, adapters na fronteira (persistência contra o Postgres real, marketplaces contra o WireMock com os mappings de `../docker/wiremock`, mensageria com fakes do producer e das mensagens).
- Siga o Clean Code: nomes pequenos que revelam a intenção, responsabilidade única, sem comentários que repetem o código.

## Integração com os marketplaces

- **`MarketplacePort`** (`core/marketplace/port/out/`): o que o core precisa de um marketplace, no modelo canônico. Cada chamada falha com `MarketplaceUnavailableError` (timeout, sem conexão, `429` ou `5xx`: vale tentar de novo) ou `MarketplaceRejectedError` (a resposta mostra que repetir não adianta). `CircuitOpenError` é uma indisponibilidade com `attempts: 0`.
- **Adapters** (`infra/marketplace/<marketplace>.marketplace.ts`): traduzem o modelo canônico para a API do simulador e a resposta de volta. A tradução (ids em texto, datas em UTC, preço unitário, erro dentro do `200` da Shopee) fica toda neles. Cada um valida o payload com zod, descarta com um log `warn` o pedido que não consegue traduzir e ignora o que não está no status esperado. Um marketplace novo é um adapter e uma linha em `marketplaces.factory.ts`.
- **`MarketplaceHttpClient`**: fala JSON, aplica o timeout e transforma toda falha num dos dois erros da porta. Não usa biblioteca nova: é o `fetch` do Node.
- **`ResilientMarketplace`** (ADR-0009): decorator da porta, um por marketplace. Tenta de novo a falha transitória, até `MARKETPLACE_MAX_ATTEMPTS`, com espera exponencial e jitter (e o `Retry-After`, no máximo 5 s). Não repete a recusa. O circuit breaker abre depois de `MARKETPLACE_BREAKER_FAILURES` falhas seguidas, recusa por `MARKETPLACE_BREAKER_COOLDOWN_MS` e então deixa uma chamada passar. O estado fica na memória. Relógio, `sleep` e `random` entram por injeção, para o teste não esperar.
- **Pedidos** (ADR-0010): `OrderPollers` roda um `PeriodicTask` por marketplace, a cada `ORDER_POLL_INTERVAL_MS`. Cada ciclo chama `OrderFacade.receive`, que consulta desde o cursor menos `ORDER_POLL_OVERLAP_MS` (ou as últimas `ORDER_POLL_LOOKBACK_MS`, sem cursor), grava cada pedido novo e o evento `marketplace.order.received.v1` na mesma transação (`marketplace_orders` e `outbox`) e só então move o cursor. O simulador devolve todos os pedidos a cada consulta, e quem evita a duplicata é a chave primária. Um marketplace que não responde pula o ciclo (log `warn`) sem mexer no cursor nem nos outros.
- **Cancelamento**: `OrderCancelledConsumer` (grupo `marketplace-gateway-order-cancelled`) lê `order.order.cancelled.v1` e cancela no marketplace do evento. `marketplace` e `externalOrderId` são obrigatórios para o gateway (no catálogo de eventos ainda são opcionais): sem eles, a mensagem vai para `marketplace.order-cancelled.dlq`, como a fora do contrato e a recusada pelo marketplace. O motivo `MARKETPLACE_CANCELLED` não chama o marketplace. A indisponibilidade é relançada, e o Kafka reentrega. A deduplicação é por `ce_id` (`processed_events`).
- **Anúncios** (ADR-0011): `CatalogProductConsumer` (grupo `marketplace-gateway-catalog-product`) lê `catalog.product.approved.v1`, que traz só `productId` e `sku`. `ListingFacade.publish` lê o produto em `GET /products/sku/:sku` do catalog (`HttpProductCatalog`) **antes de gravar qualquer coisa**, e então publica nos marketplaces que ainda não têm o anúncio `PUBLISHED`, os três ao mesmo tempo. Cada anúncio é gravado `PENDING` antes da chamada (a API já o mostra a caminho) e termina `PUBLISHED`, com o id que o marketplace deu, ou `FAILED`, com o motivo e as tentativas; o evento `marketplace.listing.published.v1` ou `marketplace.listing.failed.v1` entra no outbox na mesma transação do `save`. A falha de um marketplace nunca impede os outros, e a mensagem é consumida. O id do anúncio vai no header `Idempotency-Key` de toda chamada, a mesma em cada nova tentativa.
- **Falha do catalog**: produto que não existe (`404`) ou que não está `APPROVED` vai para `marketplace.catalog-product.dlq`; o catalog fora do ar (timeout, conexão, `408`, `429`, `5xx`) é relançado, nenhum anúncio é criado e o Kafka reentrega. Um anúncio `FAILED` ou `PENDING` (queda do processo) só é tentado de novo quando o `approved` é reentregue: não há endpoint de retry.
- **API de anúncios** (contrato da #35, `application/problem+json` nos erros): `GET /listings?sku=&marketplace=&status=&limit=20&offset=0` responde `{"listings":[Listing],"limit":20,"offset":0}` (`limit` de 1 a 100, ordem por `sku` e `marketplace`, filtro vazio vale como ausente, `sku` em maiúsculas) e `GET /listings/{id}` responde um `Listing`: `id`, `sku`, `marketplace`, `externalListingId`, `status` (`PUBLISHED`, `FAILED` ou `PENDING`), `price`, `stock`, `failureReason` e `updatedAt`. Valor inválido responde `422`, anúncio inexistente `404` e requisição malformada `400`. Os schemas zod ficam em `infra/http/listing/listing.schemas.ts` e `infra/http/validate.ts` transforma a falha em `RequestValidationError`.
- Cada ciclo de polling roda dentro de um span (`withSpan`), então as chamadas HTTP e o evento gravado no outbox aparecem num trace só.
- Simuladores e demo: `../docs/simuladores-marketplaces.md`. `../scripts/simulate-order.sh all` registra um pedido de cada marketplace, e `../scripts/simulate-failure.sh <marketplace> unavailable|throttled|slow|flaky|off` liga e desliga as falhas.

## Testes

- Specs sem container são `*.spec.ts` (projeto Jest `unit`): fakes, supertest, timers falsos, um servidor HTTP local. Specs que precisam do Docker são `*.int.spec.ts` (projeto `integration`).
- O projeto `integration` sobe **um** Postgres (`postgres:18-alpine`, dados em tmpfs, `fsync=off`) e **um** WireMock (`wiremock/wiremock:3.13.2`, com os mappings de `../docker/wiremock` copiados para o container) para a execução inteira, em `src/infra/testing/global-setup.ts`. Cada arquivo de spec cria o próprio banco com `createTestDatabase()`, e os specs que usam o WireMock o devolvem ao estado dos arquivos com `resetWiremock()` antes de cada teste (`src/infra/testing/wiremock.ts`). O container só sobe quando um spec de integração é selecionado: `npm run test:unit` e `npx jest <spec unitário>` não precisam do Docker.
- Os specs de integração rodam em série (`--runInBand` nos scripts), porque dividem o WireMock: o cenário de falha ou o pedido de um teste apareceria no outro.
- `src/infra/order.module.int.spec.ts` e `src/infra/listing.module.int.spec.ts` ligam um fluxo inteiro (adapters contra o WireMock, Postgres, outbox e relay) com o Kafka e, no caso dos anúncios, o catalog trocados por fakes. O produto do catalog vem de um servidor HTTP local, que responde o que o teste manda.
- Os testes de integração rodam os scripts da demo (`simulate-order.sh` e `simulate-failure.sh`) como eles são, então precisam de `bash`, `curl` e `jq`.
- Com `TEST_POSTGRES_URI=postgres://usuario:senha@host:porta/banco` ou `TEST_WIREMOCK_URL=http://host:porta` o projeto usa esse servidor e não sobe o container correspondente (útil quando a máquina está lenta; o WireMock externo precisa ter os mesmos mappings).
- Em máquina lenta, a primeira subida dos containers pode levar alguns minutos. Se um teste falhar por tempo de container, repita só ele antes de procurar um defeito.

## Health check

`GET /health` roda `select 1` no Postgres com timeout de 2 s: `200 {"status":"UP"}`, ou `503 {"status":"DOWN"}` com um log `warn`. Não verifica o Kafka nem os marketplaces: uma queda do Kafka só atrasa a publicação, porque os eventos esperam no outbox, e um marketplace fora do ar só pausa o polling dele. O Dockerfile e o compose usam o endpoint como healthcheck.

## Observabilidade

- `infra/observability/instrumentation.ts` inicia o `NodeSDK` e precisa rodar antes de qualquer outro módulo. `dev` e `start` o carregam com `--require`; nunca o importe do código da aplicação.
- Em `SIGTERM`/`SIGINT` ele só descarrega o SDK. Quem encerra o processo é o `main.ts`: fecha o servidor, desconecta o consumer, espera a rodada dos pollers e a do relay, desconecta o producer, destrói o pool e sai com código 0.
- Logs: use o `Logger` do pino. O `instrumentation-pino` adiciona `trace_id`/`span_id` e envia cada registro ao coletor. Os avisos do Knex também passam pelo pino (`createDatabaseConnection`), então toda linha é JSON.
- Métricas e spans customizados: use `@opentelemetry/api` dentro de `infra`, nunca no `core`.

## Mensageria (Kafka)

Os eventos de domínio chegam ao Kafka por um outbox transacional (`../docs/adr/0002-outbox-para-eventos-do-catalog-service.md`):

- Os agregados estendem `AggregateRoot` e usam `record(...)` para registrar eventos de domínio. O repositório salva o agregado e acrescenta `pullDomainEvents()` com `KnexOutboxRepository.append(tx, aggregateType, events)` na mesma transação.
- O `KnexOutboxRepository` guarda o evento de integração, não o de domínio. Todo evento que sai do serviço precisa de um mapeamento em `infra/messaging/<agregado>.integration-events.ts` (tipo público e versionado, como `marketplace.order.received.v1`); o mapper lança erro para um evento sem mapeamento, e a transação não grava nada.
- O `OutboxRelay` roda a cada 1000 ms (uma rodada por vez), pega até 100 linhas pendentes em ordem de `sequence` com `FOR UPDATE SKIP LOCKED`, publica cada uma no tópico com o nome do tipo, com `aggregate_id` como chave e os headers CloudEvents `ce_*` (`ce_source=/marketplace-gateway`), e então preenche `published_at`. Um envio que falha deixa as linhas pendentes para a rodada seguinte. A entrega é at-least-once: os consumidores deduplicam por `ce_id`.
- O relay envia cada evento dentro do trace que o registrou (a coluna `headers` do outbox guarda o contexto W3C).
- O producer é idempotente, com uma requisição em voo e 5 tentativas. O serviço não sobe sem o Kafka (`producer.connect()` roda antes de `listen`).
- Todo tópico novo, publicado ou consumido, entra em `../docker/kafka/create-topics.sh`. Os tópicos do gateway já estão lá: `marketplace.order.received.v1`, `marketplace.listing.published.v1`, `marketplace.listing.failed.v1` e as DLQs `marketplace.catalog-product.dlq` e `marketplace.order-cancelled.dlq`.
- Os consumers são adapters de entrada: validam a mensagem com zod, usam `processed_events` para pular reentregas, mandam para a DLQ a mensagem que nunca vai dar certo e relançam qualquer outra coisa para o Kafka reentregar.
