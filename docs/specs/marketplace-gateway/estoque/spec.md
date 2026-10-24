# marketplace-gateway estoque Specification

Issue: #33 · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `IF`, `WHILE`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

Uma venda reduz o estoque no catalog, que é o dono dele (ADR-0004) e publica `catalog.product.stock-changed.v1` com o valor absoluto depois da mudança. Sem levar esse valor aos anúncios, o produto segue à venda nos marketplaces depois de acabar. A #33 pede que o `marketplace-gateway` atualize o anúncio em cada marketplace e zere a disponibilidade quando o estoque acaba. A [ADR-0009](../../../adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md) manda gravar o valor no anúncio como pendente e reenviar por um laço periódico, em vez de relançar a mensagem, e a [ADR-0011](../../../adr/0011-dados-do-produto-por-consulta-ao-catalog.md) manda descartar o evento que chega antes de o anúncio existir.

## Goals

- [ ] Uma venda reduz o estoque anunciado nos 3 simuladores.
- [ ] O estoque 0 zera a disponibilidade dos anúncios.
- [ ] Um marketplace fora do ar não atrasa nem trava os outros, e recebe o estoque certo quando volta.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Sincronizar o preço | O catálogo de eventos não tem evento de preço e o catalog-service não muda o preço depois do cadastro, então não há gatilho. A `MarketplacePort` só atualiza estoque, e um `updatePrice` entra junto com o evento |
| Atualizar anúncio `PENDING` ou `FAILED` | A publicação lê o estoque atual do catalog, então o evento é descartado |
| Conferir o estoque que o marketplace tem (consultar o anúncio) | O gateway confia no que enviou |
| Estoque por variação do produto | O catálogo tem um estoque por SKU; a Shopee recebe o `model_id` 0 |
| Espera crescente por anúncio entre as tentativas do laço | O circuit breaker já poupa o marketplace fora do ar, e o laço tenta de novo a cada rodada |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quando o gateway envia o estoque | Num laço por marketplace, a cada 2 s, e nunca dentro do consumer | O consumer não espera marketplace (ADR-0009), e a falha de um não trava o grupo do Kafka | y |
| Onde fica o estoque pendente | Em `listings.stock`, com `stock_synced = false` até o marketplace aceitar | ADR-0009 | y |
| O que o `Listing` da API mostra | O estoque mais novo recebido do catalog, mesmo antes de o marketplace confirmar | O contrato da #35 tem um só campo `stock`, e o envio leva poucos segundos | y |
| Evento de um SKU sem anúncio `PUBLISHED` | Descartado | ADR-0011: a publicação, ou a nova tentativa, lê o estoque atual do catalog | y |
| Evento que chega com o anúncio `PENDING` | Descartado, e a publicação termina com o estoque que leu | Gravar o estoque enquanto a publicação salva o anúncio por cima perderia um dos dois valores; o próximo evento do SKU corrige | n |
| Recusa do marketplace | Tratada como a indisponibilidade: o anúncio fica pendente e a rodada seguinte tenta de novo | A porta separa recusa e indisponibilidade, mas nenhuma regra de negócio muda o destino do estoque | n |
| Vários eventos antes do envio | Só o último é enviado | O valor é absoluto, então o último substitui os anteriores | y |
| Tamanho do lote | 50 anúncios por marketplace e por rodada, em `STOCK_SYNC_BATCH_SIZE` | Limita o trabalho de uma rodada | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Reduzir o estoque anunciado a cada mudança no catalog ⭐ MVP

**User Story**: Como lojista, quero que a venda de um produto reduza o estoque anunciado nos marketplaces para não vender o que não tenho.

**Why P1**: É o critério de aceite da #33: uma venda reduz o estoque anunciado nos 3 marketplaces.

**Acceptance Criteria**:

1. WHEN chega `catalog.product.stock-changed.v1` com um estoque diferente do gravado THEN o gateway SHALL gravar o novo estoque nos anúncios `PUBLISHED` do SKU, em todos os marketplaces, e marcá-los como ainda não enviados. (`MKTSTK-01`)
2. WHEN há anúncios `PUBLISHED` com o estoque ainda não enviado THEN o gateway SHALL enviar o estoque ao marketplace de cada um, e marcá-lo como enviado quando o marketplace aceita. (`MKTSTK-02`)
3. The estoque enviado SHALL ser o valor absoluto do evento, não uma diferença, e vários eventos antes de um envio SHALL resultar no envio só do último. (`MKTSTK-03`)
4. WHEN o estoque é 0 THEN o gateway SHALL enviar 0 ao marketplace, o que zera a disponibilidade do anúncio. (`MKTSTK-04`)
5. WHEN o estoque do evento é igual ao gravado THEN o gateway SHALL não marcar o anúncio como não enviado nem chamar o marketplace. (`MKTSTK-05`)
6. WHEN o SKU não tem anúncio `PUBLISHED` (não existe, ou está `PENDING` ou `FAILED`) THEN o gateway SHALL descartar o evento sem erro. (`MKTSTK-06`)
7. WHEN a mesma mensagem (mesmo `ce_id`) chega de novo THEN o consumer SHALL não fazer nada. (`MKTSTK-07`)
8. IF a mensagem está fora do contrato (JSON inválido, `productId` que não é UUID, `sku` vazio, `stock` que não é um inteiro maior ou igual a 0) THEN o consumer SHALL enviá-la a `marketplace.catalog-product.dlq`. (`MKTSTK-08`)
9. WHEN o consumer trata um evento de estoque THEN o consumer SHALL não chamar nenhum marketplace, de modo que um marketplace fora do ar nunca atrasa o Kafka. (`MKTSTK-09`)
10. WHEN o estoque é gravado THEN o `stock` e o `updatedAt` do `Listing` na API SHALL mostrar o novo valor. (`MKTSTK-10`)
11. WHEN um estoque mais novo é gravado enquanto o anterior está a caminho THEN o gateway SHALL manter o anúncio como não enviado, e a rodada seguinte SHALL enviar o novo. (`MKTSTK-11`)

**Independent Test**: Com `make up` e um produto publicado, publicar `{"productId":"<uuid>","sku":"<sku>","stock":0}` em `catalog.product.stock-changed.v1` (pela Kafka UI, `localhost:8090`). Em poucos segundos `localhost:8089/__admin/requests` mostra 3 chamadas de atualização com o estoque 0, e `GET localhost:8087/listings?sku=<sku>` mostra `stock: 0` nos 3 anúncios.

---

### P1: Sincronizar sem que um marketplace atrapalhe os outros ⭐ MVP

**User Story**: Como lojista, quero que a falha de um marketplace não impeça os outros de receber o estoque, e que ele chegue ao valor certo quando o marketplace voltar.

**Why P1**: É a regra de resiliência da ADR-0009 aplicada ao estoque.

**Acceptance Criteria**:

1. The gateway SHALL manter um laço de sincronização por marketplace, a cada `STOCK_SYNC_INTERVAL_MS`, com uma rodada de cada vez e no máximo `STOCK_SYNC_BATCH_SIZE` anúncios por rodada. (`MKTSTK-12`)
2. IF o marketplace não responde (indisponível depois das tentativas, ou circuito aberto) THEN o gateway SHALL manter o anúncio como não enviado e tentar de novo na rodada seguinte, sem relançar a mensagem do Kafka. (`MKTSTK-13`)
3. IF o marketplace recusa o estoque THEN o gateway SHALL manter o anúncio como não enviado, registrar um aviso com o motivo e tentar de novo na rodada seguinte. (`MKTSTK-14`)
4. WHILE um marketplace está lento ou fora do ar, o gateway SHALL seguir sincronizando os outros. (`MKTSTK-15`)
5. IF o envio de um anúncio falha THEN o gateway SHALL seguir com os outros anúncios do lote. (`MKTSTK-16`)
6. WHEN o marketplace volta THEN o gateway SHALL enviar o estoque mais novo dos anúncios pendentes, e só esse. (`MKTSTK-17`)

**Independent Test**: `scripts/simulate-failure.sh shopee unavailable`, publicar um `stock-changed`: Amazon e Mercado Livre recebem na hora, e a Shopee fica com o log `Stock not sent`. Depois de `scripts/simulate-failure.sh shopee off`, a Shopee recebe o estoque, sem que as outras recebam de novo.

---

### P1: Falar o formato de cada marketplace ⭐ MVP

**User Story**: Como gateway, quero que cada adapter traduza a atualização de estoque para a API do seu marketplace, com a mesma resiliência das outras chamadas.

**Why P1**: Sem a tradução, o estoque não chega a nenhum dos três simuladores.

**Acceptance Criteria**:

1. WHEN o adapter atualiza o estoque THEN o adapter SHALL falar o formato do marketplace: `PATCH` por SKU com JSON Patch de `/attributes/fulfillment_availability` na Amazon, `PUT /items/{id}` com `available_quantity` no Mercado Livre e `update_stock` com `stock_list` e `model_id` 0 na Shopee, em que o erro vem dentro do `200`. (`MKTSTK-18`)
2. IF a resposta mostra que o marketplace não aceitou o estoque (status diferente de `ACCEPTED` na Amazon, `failure_list` não vazia ou erro dentro do `200` na Shopee) THEN o adapter SHALL falhar com `MarketplaceRejectedError` e o motivo do marketplace. (`MKTSTK-19`)
3. WHEN a atualização falha por indisponibilidade THEN o `ResilientMarketplace` SHALL repetir a chamada até 3 vezes, com o mesmo estoque, e abrir o circuit breaker como nas outras chamadas. (`MKTSTK-20`)

**Independent Test**: `npx jest src/infra/marketplace/marketplace-adapters.int.spec.ts` confere as três chamadas contra os mappings de `docker/wiremock`.

---

### P2: Configuração

**User Story**: Como integrante do time, quero configurar o laço de estoque e o tópico por variável de ambiente.

**Why P2**: Os padrões bastam localmente.

**Acceptance Criteria**:

1. WHEN as variáveis de ambiente não estão definidas THEN `loadConfig` SHALL devolver `STOCK_SYNC_INTERVAL_MS` 2000, `STOCK_SYNC_BATCH_SIZE` 50 e o tópico `catalog.product.stock-changed.v1`. (`MKTSTK-21`)
2. IF `STOCK_SYNC_INTERVAL_MS` ou `STOCK_SYNC_BATCH_SIZE` não é um inteiro maior que zero THEN `loadConfig` SHALL falhar com `Invalid <NOME>: <valor>`. (`MKTSTK-22`)

**Independent Test**: Subir com `STOCK_SYNC_BATCH_SIZE=0` termina com código 1 e `Invalid STOCK_SYNC_BATCH_SIZE: 0`.

---

## Requirement Traceability

Caminhos relativos a `marketplace-gateway/src/`. `infra/listing.module.int.spec.ts` liga tudo menos o Kafka e o catalog: consumer, facades, laços de sincronização, adapters com a resiliência contra o WireMock, Postgres e API.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| MKTSTK-01 | P1: Reduzir o estoque anunciado | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/messaging/catalog-product.consumer.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-02 | P1: Reduzir o estoque anunciado | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-03 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-04 | P1: Reduzir o estoque anunciado | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-05 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-06 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-07 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-08 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts`, `core/listing/stock.facade.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-09 | P1: Reduzir o estoque anunciado | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/messaging/catalog-product.consumer.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-10 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-11 | P1: Reduzir o estoque anunciado | - | Implementing | `infra/persistence/knex-listing-stock.repository.int.spec.ts`, `core/listing/stock.facade.spec.ts` |
| MKTSTK-12 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `infra/polling/stock-synchronizers.spec.ts`, `core/listing/stock.facade.spec.ts` |
| MKTSTK-13 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/polling/stock-synchronizers.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-14 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `core/listing/stock.facade.spec.ts`, `infra/polling/stock-synchronizers.spec.ts` |
| MKTSTK-15 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `infra/polling/stock-synchronizers.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTSTK-16 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `core/listing/stock.facade.spec.ts` |
| MKTSTK-17 | P1: Sincronizar sem que um marketplace atrapalhe | - | Implementing | `infra/listing.module.int.spec.ts` |
| MKTSTK-18 | P1: Falar o formato de cada marketplace | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTSTK-19 | P1: Falar o formato de cada marketplace | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts` |
| MKTSTK-20 | P1: Falar o formato de cada marketplace | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts`, `infra/marketplace/marketplace-resilience.int.spec.ts` |
| MKTSTK-21 | P2: Configuração | - | Implementing | `infra/config/env.spec.ts` |
| MKTSTK-22 | P2: Configuração | - | Implementing | `infra/config/env.spec.ts` |

**Coverage:** 22 total, 22 mapped to tests, 0 unmapped.

---

## Success Criteria

- [ ] Com `make up`, um `catalog.product.stock-changed.v1` muda o `stock` dos 3 anúncios de `GET localhost:8087/listings?sku=<sku>`, e o WireMock registra 3 chamadas de atualização.
- [ ] Com `scripts/simulate-failure.sh shopee unavailable`, a Amazon e o Mercado Livre recebem o estoque e a Shopee o recebe só depois do `off`, sem repetir o envio às outras.
- [ ] `npm test` passa, e o workflow `marketplace-gateway` fica verde no PR.
