# marketplace-gateway anúncios Specification

Issue: #21 (com a API de consulta que a #35 usa) · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `IF`, `WHILE`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

O produto aprovado pelo compliance só vira venda quando aparece anunciado nos marketplaces. A #21 pede que o `marketplace-gateway` consuma `catalog.product.approved.v1`, publique o anúncio nos três simuladores, guarde o status de cada um e avise o resultado em `marketplace.listing.published.v1` e `marketplace.listing.failed.v1`, e que o BFF (#35) consulte esse status por uma API REST. A [ADR-0011](../../../adr/0011-dados-do-produto-por-consulta-ao-catalog.md) escolhe buscar os dados do produto no catalog, e a [ADR-0009](../../../adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md) define como a falha de um marketplace é tratada.

## Goals

- [ ] Um produto aprovado aparece publicado nos 3 simuladores.
- [ ] A falha de um marketplace não impede a publicação nos outros.
- [ ] O BFF consulta o status dos anúncios por marketplace, com o contrato combinado.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Sincronizar estoque e preço depois da publicação | #33 |
| Tentar de novo um anúncio `FAILED` por uma chamada da API | Não há endpoint de retry; o anúncio é tentado de novo quando `catalog.product.approved.v1` é entregue outra vez |
| Categoria, imagens e atributos do produto por marketplace | O catalog não os tem; os adapters usam a categoria padrão dos simuladores |
| Autenticação da API | O BFF é o resource server; os serviços internos não validam token |
| Evento ou API para despublicar um anúncio | Nenhum requisito |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quem busca os dados do produto | `GET /products/sku/:sku` do catalog, na hora de publicar | ADR-0011 | y |
| Marketplaces de cada produto | Os três, sempre | Os três têm adapter; o produto nasce em todos | y |
| Falha do marketplace | O anúncio daquele marketplace vira `FAILED` e a mensagem é consumida | ADR-0009: a falha de um não atrasa nem trava os outros | y |
| Falha do catalog | O erro é relançado e o Kafka reentrega; nenhum anúncio é criado antes de o produto ser lido | O produto é lido antes de qualquer gravação | y |
| Produto que não está `APPROVED` no catalog | Vai para a DLQ | O evento só sai depois da aprovação; um estado diferente nunca vai mudar | y |
| Chave dos eventos de anúncio | O `productId`, como o catálogo de eventos define | Mantém a ordem por produto dentro de cada tópico | y |
| `attempts` do evento de falha | O número de chamadas HTTP feitas; recusa conta 1 e circuito aberto conta 0 | "Tentativas feitas antes de desistir" | y |
| Ordem da listagem | Por `sku` e `marketplace` | É a única que não muda com os updates durante a paginação | y |
| Filtro vazio na listagem (`sku=`) | Vale como se o filtro não existisse | O contrato mostra os filtros em branco | y |
| `sku` do filtro | Aparado e em maiúsculas | O catálogo só guarda SKU em maiúsculas | y |
| Erros da API | `422` para valor inválido (`limit`, `offset`, `marketplace`, `status`, `id` que não é UUID), `404` para anúncio que não existe e `400` para requisição malformada (JSON inválido, `%` mal formado no caminho) | O contrato fixa os três códigos; a distinção segue a semântica HTTP | n |
| Anúncio que ficou `PENDING` por uma queda do processo | É tentado de novo quando o `approved` é reentregue | O estado `PENDING` não tem terminal | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Publicar os produtos aprovados nos marketplaces ⭐ MVP

**User Story**: Como lojista, quero que o produto aprovado seja anunciado nos três marketplaces para vender nele sem cadastrar nada à mão.

**Why P1**: É o que liga a análise de conformidade à venda.

**Acceptance Criteria**:

1. WHEN chega `catalog.product.approved.v1` e algum marketplace ainda não tem o anúncio publicado THEN o gateway SHALL buscar o produto em `GET /products/sku/:sku` do catalog. (`MKTLST-01`)
2. WHEN o produto está `APPROVED` THEN o gateway SHALL publicar o anúncio no Amazon, no Mercado Livre e na Shopee, cada um pelo seu adapter, ao mesmo tempo. (`MKTLST-02`)
3. WHILE o gateway publica o anúncio num marketplace, o anúncio SHALL estar `PENDING` e aparecer assim na API. (`MKTLST-03`)
4. WHEN o marketplace aceita THEN o gateway SHALL guardar o anúncio como `PUBLISHED`, com o `externalListingId` que o marketplace devolveu, e gravar `marketplace.listing.published.v1` na mesma transação. (`MKTLST-04`)
5. IF a publicação num marketplace falha (indisponível depois das tentativas, ou recusada) THEN o gateway SHALL guardar o anúncio como `FAILED`, com o motivo e o número de tentativas, e gravar `marketplace.listing.failed.v1` na mesma transação. (`MKTLST-05`)
6. IF um marketplace falha THEN o gateway SHALL publicar nos outros normalmente e consumir a mensagem. (`MKTLST-06`)
7. IF o marketplace recusa o preço (menor ou igual a zero) THEN o anúncio SHALL ficar `FAILED` na primeira tentativa, com o motivo do marketplace. (`MKTLST-07`)
8. WHEN o anúncio de um marketplace já está `PUBLISHED` THEN o gateway SHALL não publicar de novo nesse marketplace. (`MKTLST-08`)
9. WHEN um anúncio está `FAILED` ou `PENDING` e `catalog.product.approved.v1` chega de novo THEN o gateway SHALL tentar de novo só nos marketplaces que não estão `PUBLISHED`. (`MKTLST-09`)
10. WHEN a mesma mensagem (mesmo `ce_id`) chega de novo THEN o consumer SHALL não fazer nada. (`MKTLST-10`)
11. IF a mensagem está fora do contrato (JSON inválido, `productId` que não é UUID, `sku` vazio) THEN o consumer SHALL enviá-la a `marketplace.catalog-product.dlq`. (`MKTLST-11`)
12. IF o catalog responde `404` ou o produto não está `APPROVED` THEN o consumer SHALL enviar a mensagem à DLQ, sem criar anúncio. (`MKTLST-12`)
13. IF o catalog está indisponível (timeout, conexão, `5xx`) THEN o consumer SHALL relançar o erro para o Kafka reentregar, sem criar anúncio. (`MKTLST-13`)
14. The eventos `marketplace.listing.published.v1` e `marketplace.listing.failed.v1` SHALL ter como chave o `productId` e os dados do catálogo de eventos (`productId`, `sku`, `marketplace`, `externalListingId` e `publishedAt`; ou `reason` e `attempts`). (`MKTLST-14`)
15. WHEN o gateway publica um anúncio THEN o gateway SHALL enviar o id do anúncio no header `Idempotency-Key` aos três marketplaces, o mesmo em toda nova tentativa. (`MKTLST-15`)
16. WHEN o adapter publica THEN o adapter SHALL falar o formato do marketplace: `PUT` por SKU com `asin` na resposta na Amazon, `POST /items` com `id` no Mercado Livre e `add_item` com `item_id` na Shopee, em que o erro vem dentro do `200`. (`MKTLST-16`)

**Independent Test**: Importar um produto com `make up`, esperar a aprovação e abrir `GET localhost:8087/listings?sku=<sku>`: 3 anúncios `PUBLISHED`. Importar um com preço `0`: 3 anúncios `FAILED` com o motivo de cada marketplace.

---

### P1: Consultar o status dos anúncios (API para o BFF) ⭐ MVP

**User Story**: Como BFF (#35), quero consultar o status dos anúncios de um produto em cada marketplace para mostrá-lo ao lojista.

**Why P1**: O contrato com o BFF é o que fecha a #35.

**Acceptance Criteria**:

1. WHEN o BFF chama `GET /listings` THEN o gateway SHALL responder `200` com `{"listings":[...],"limit":20,"offset":0}`, com `limit` 20 e `offset` 0 por padrão. (`MKTLST-17`)
2. The item de `listings` SHALL ter `id`, `sku`, `marketplace`, `externalListingId`, `status`, `price`, `stock`, `failureReason` e `updatedAt`, e o `externalListingId` e o `failureReason` SHALL ser `null` quando não existem. (`MKTLST-18`)
3. WHEN a chamada traz `sku`, `marketplace` ou `status` THEN o gateway SHALL listar só os anúncios que casam com todos os filtros dados, e o `sku` SHALL valer sem distinguir maiúsculas. (`MKTLST-19`)
4. WHEN a chamada traz `limit` e `offset` THEN o gateway SHALL paginar a lista ordenada por `sku` e `marketplace`, e devolver o `limit` e o `offset` usados. (`MKTLST-20`)
5. IF `limit` não é um inteiro de 1 a 100, `offset` não é um inteiro maior ou igual a 0, ou `marketplace` ou `status` não existem THEN o gateway SHALL responder `422` em `application/problem+json`. (`MKTLST-21`)
6. WHEN o BFF chama `GET /listings/{id}` com o id de um anúncio THEN o gateway SHALL responder `200` com esse `Listing`. (`MKTLST-22`)
7. IF não existe anúncio com o id THEN o gateway SHALL responder `404` em `application/problem+json`. (`MKTLST-23`)
8. IF o `id` não é um UUID THEN o gateway SHALL responder `422` em `application/problem+json`. (`MKTLST-24`)
9. IF a requisição é malformada (um `%` mal formado no caminho) THEN o gateway SHALL responder `400` em `application/problem+json`. (`MKTLST-25`)

**Independent Test**: `curl 'localhost:8087/listings?marketplace=SHOPEE&status=FAILED&limit=5'` lista só os anúncios `FAILED` da Shopee; `curl localhost:8087/listings?limit=101` responde `422`.

---

### P2: Configuração

**User Story**: Como integrante do time, quero configurar o catalog e os tópicos por variável de ambiente.

**Why P2**: Os padrões bastam localmente; o compose troca a URL do catalog.

**Acceptance Criteria**:

1. WHEN as variáveis de ambiente não estão definidas THEN `loadConfig` SHALL devolver `CATALOG_SERVICE_URL` `http://localhost:8082`, `CATALOG_TIMEOUT_MS` 3000, `AMAZON_SELLER_ID` `A1B2C3D4E5`, e os tópicos `catalog.product.approved.v1` e `marketplace.catalog-product.dlq`. (`MKTLST-26`)
2. IF `CATALOG_TIMEOUT_MS` não é um inteiro maior que zero, ou `CATALOG_SERVICE_URL` não é uma URL, THEN `loadConfig` SHALL falhar com `Invalid <NOME>: <valor>`. (`MKTLST-27`)

**Independent Test**: Subir com `CATALOG_SERVICE_URL=abc` termina com código 1 e `Invalid CATALOG_SERVICE_URL: abc`.

---

## Requirement Traceability

Caminhos relativos a `marketplace-gateway/src/`. `infra/listing.module.int.spec.ts` liga tudo menos o Kafka e o catalog (um servidor HTTP local): consumer, facade, adapters com a resiliência contra o WireMock, Postgres, outbox, relay e API.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| MKTLST-01 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/catalog/http-product-catalog.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-02 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-03 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-04 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/model/listing.entity.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-05 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-06 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-07 | P1: Publicar os produtos aprovados | - | Implementing | `infra/marketplace/marketplace-adapters.int.spec.ts`, `infra/marketplace/marketplace-resilience.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-08 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-09 | P1: Publicar os produtos aprovados | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-10 | P1: Publicar os produtos aprovados | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-11 | P1: Publicar os produtos aprovados | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts` |
| MKTLST-12 | P1: Publicar os produtos aprovados | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts`, `infra/catalog/http-product-catalog.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-13 | P1: Publicar os produtos aprovados | - | Implementing | `infra/messaging/catalog-product.consumer.spec.ts`, `infra/catalog/http-product-catalog.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-14 | P1: Publicar os produtos aprovados | - | Implementing | `infra/messaging/listing.integration-events.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-15 | P1: Publicar os produtos aprovados | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts`, `infra/marketplace/resilient-marketplace.spec.ts`, `infra/marketplace/marketplace-resilience.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-16 | P1: Publicar os produtos aprovados | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTLST-17 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-18 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts` |
| MKTLST-19 | P1: Consultar o status dos anúncios | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/http/listing/listing.routes.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts` |
| MKTLST-20 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts` |
| MKTLST-21 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/http/error-handler.spec.ts` |
| MKTLST-22 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/persistence/knex-listing.repository.int.spec.ts`, `infra/listing.module.int.spec.ts` |
| MKTLST-23 | P1: Consultar o status dos anúncios | - | Implementing | `core/listing/listing.facade.spec.ts`, `infra/http/listing/listing.routes.spec.ts` |
| MKTLST-24 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts` |
| MKTLST-25 | P1: Consultar o status dos anúncios | - | Implementing | `infra/http/listing/listing.routes.spec.ts`, `infra/http/error-handler.spec.ts` |
| MKTLST-26 | P2: Configuração | - | Implementing | `infra/config/env.spec.ts` |
| MKTLST-27 | P2: Configuração | - | Implementing | `infra/config/env.spec.ts` |

**Coverage:** 27 total, 27 mapped to tests, 0 unmapped.

---

## Success Criteria

- [ ] Com `make up`, um produto aprovado vira 3 anúncios `PUBLISHED` em `GET localhost:8087/listings?sku=<sku>` e 3 eventos `marketplace.listing.published.v1` no Kafka.
- [ ] Com `scripts/simulate-failure.sh shopee unavailable`, a Shopee fica `FAILED` com `attempts: 3` e a Amazon e o Mercado Livre ficam `PUBLISHED`.
- [ ] `npm test` passa, e o workflow `marketplace-gateway` fica verde no PR.
