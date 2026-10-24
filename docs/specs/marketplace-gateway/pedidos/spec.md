# marketplace-gateway pedidos Specification

Issue: #22 · Dono: Diego Diógenes · Data: 2026-10-24
Os títulos das seções e as palavras-chave EARS (`WHEN`, `IF`, `WHILE`, `SHALL`) seguem o template da skill `tlc-spec-driven`, que o `validate_spec.py` confere. O conteúdo está em português.

## Problem Statement

O pedido nasce no marketplace e o resto do sistema só o conhece como `marketplace.order.received.v1`. A #22 pede que o `marketplace-gateway` receba os pedidos de Amazon, Mercado Livre e Shopee, traduza cada formato para o canônico e publique o evento sem duplicar. A [ADR-0010](../../../adr/0010-pedidos-dos-marketplaces-por-polling.md) escolhe o polling, a [ADR-0008](../../../adr/0008-anticorruption-layer-um-adapter-por-marketplace.md) a anti-corruption layer e a [ADR-0009](../../../adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md) a política de resiliência. Esta feature entrega os três juntos, mais o cancelamento do pedido no marketplace (ADR-0004), que usa o mesmo adapter e a mesma resiliência.

## Goals

- [ ] Um pedido de cada marketplace simulado chega ao Kafka no formato canônico (`marketplace.order.received.v1`), uma única vez.
- [ ] `order.order.cancelled.v1` cancela o pedido no marketplace certo.
- [ ] A queda de um marketplace não atrasa nem derruba os outros.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Publicar anúncios e atualizar estoque e preço nos marketplaces | #21 e #33 (as operações entram na mesma `MarketplacePort`) |
| API REST de consulta | #21 (contrato com o BFF em #35) |
| Pedido cancelado pelo comprador no marketplace (`MARKETPLACE_CANCELLED`) | Não há evento que o produza; o gateway só ignora esse motivo |
| Dados do comprador e do frete no evento | Em aberto no catálogo de eventos até algum serviço precisar |
| Autenticação nos marketplaces | Os simuladores não autenticam |
| Reconciliação de pedido que o marketplace lista com atraso maior que a sobreposição | ADR-0010 registra o risco |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Intervalo, sobreposição e janela inicial do polling | 5 s, 1 min e 24 h, por `ORDER_POLL_INTERVAL_MS`, `ORDER_POLL_OVERLAP_MS` e `ORDER_POLL_LOOKBACK_MS` | ADR-0010 | y |
| `externalOrderId` | O id nativo do marketplace, convertido em texto, sem prefixo | O cancelamento precisa do id nativo, e o prefixo exigiria tirá-lo | y |
| `unitPrice` da Amazon | `ItemPrice.Amount ÷ QuantityOrdered`, com 2 casas | A Amazon informa o valor da linha | y |
| Moeda | Só BRL; outra moeda descarta o pedido | O catálogo de eventos não tem campo de moeda e todos os valores são em reais | y |
| Cancelamento sem `marketplace` ou `externalOrderId` | Vai para a DLQ | O gateway não acha o pedido sem eles; hoje são opcionais no catálogo e precisam virar obrigatórios para o gateway | n |
| Estado do pedido cancelado | O gateway não grava | Nenhum evento nem consulta precisa dele | y |
| Páginas | Até 10 por consulta, com aviso no log se o limite for atingido | Evita laço sem fim se o marketplace nunca esgotar a listagem | y |
| Intervalo de cada marketplace | Um laço por marketplace | Um marketplace lento ou fora do ar não atrasa os outros | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Receber os pedidos dos marketplaces ⭐ MVP

**User Story**: Como order-service, quero receber o pedido de cada marketplace no formato canônico, uma vez só, para reservar o estoque e cobrar sem tratar de cada API.

**Why P1**: É a entrada do fluxo de venda: sem ela, não há pedido, reserva nem cobrança.

**Acceptance Criteria**:

1. WHEN o intervalo de polling passa THEN o gateway SHALL consultar os pedidos novos de cada marketplace, cada um no seu próprio laço, a partir do cursor menos 1 minuto. (`MKTORD-01`)
2. WHEN o marketplace ainda não tem cursor THEN o gateway SHALL consultar as últimas 24 h. (`MKTORD-02`)
3. WHEN a consulta traz um pedido que o gateway ainda não viu THEN o gateway SHALL gravar o pedido e o evento `marketplace.order.received.v1` na mesma transação. (`MKTORD-03`)
4. WHEN a consulta traz um pedido já visto, com o mesmo marketplace e o mesmo `externalOrderId` THEN o gateway SHALL não gravar nem publicar nada. (`MKTORD-04`)
5. WHEN dois ciclos concorrentes veem o mesmo pedido THEN o gateway SHALL publicar um evento só. (`MKTORD-05`)
6. WHEN a consulta termina THEN o gateway SHALL guardar o instante em que ela começou como cursor do marketplace. (`MKTORD-06`)
7. IF a consulta a um marketplace falha THEN o gateway SHALL manter o cursor, logar um aviso e tentar de novo no ciclo seguinte, sem afetar os outros marketplaces. (`MKTORD-07`)
8. IF um pedido tem dado inválido (sem itens, quantidade que não é inteiro maior que zero, preço ou total negativo, moeda diferente de BRL, formato inesperado) THEN o gateway SHALL descartá-lo com um log `warn` e seguir com os demais pedidos. (`MKTORD-08`)
9. The evento `marketplace.order.received.v1` SHALL ter como chave e como `ce_subject` o `<marketplace>:<externalOrderId>` e como dados `marketplace`, `externalOrderId`, `items` (`sku`, `quantity`, `unitPrice`), `total` e `orderedAt` em ISO-8601 UTC. (`MKTORD-09`)
10. WHEN o pedido vem da Amazon THEN o adapter SHALL usar `AmazonOrderId` como `externalOrderId`, `ItemPrice.Amount` dividido por `QuantityOrdered` como `unitPrice`, `OrderTotal.Amount` como `total` e `PurchaseDate` como `orderedAt`. (`MKTORD-10`)
11. WHEN o pedido vem do Mercado Livre THEN o adapter SHALL usar o `id` em texto como `externalOrderId`, `unit_price` como `unitPrice`, `total_amount` como `total` e `date_created` convertida para UTC como `orderedAt`. (`MKTORD-11`)
12. WHEN o pedido vem da Shopee THEN o adapter SHALL usar `order_sn` como `externalOrderId`, `model_discounted_price` como `unitPrice`, `total_amount` como `total` e `create_time` (epoch em segundos) convertido para ISO-8601 UTC como `orderedAt`. (`MKTORD-12`)
13. WHEN o adapter consulta THEN o adapter SHALL pedir só os pedidos pagos e ainda não enviados, criados desde o cursor (`OrderStatuses=Unshipped` e `CreatedAfter` na Amazon, `order.status=paid` e `order.date_created.from` no Mercado Livre, `order_status=READY_TO_SHIP` e `time_from` na Shopee). (`MKTORD-13`)
14. WHEN a listagem tem mais de uma página THEN o adapter SHALL ler todas, até 10 páginas (`NextToken` na Amazon, `offset` e `limit` no Mercado Livre, `more` e `next_cursor` na Shopee). (`MKTORD-14`)
15. IF a listagem traz um pedido que não está no status esperado, como um pedido cancelado, THEN o adapter SHALL ignorá-lo. (`MKTORD-15`)

**Independent Test**: `scripts/simulate-order.sh all` e, em até 5 s, o Kafka UI mostra 3 mensagens em `marketplace.order.received.v1`, com as chaves `AMAZON:...`, `MERCADO_LIVRE:...` e `SHOPEE:...`. Rodar o script de novo com o mesmo `--id` não gera mensagem nova.

---

### P1: Cancelar o pedido no marketplace ⭐ MVP

**User Story**: Como comprador de um pedido sem estoque ou com pagamento recusado, quero que o pedido seja cancelado no marketplace para não ficar esperando uma entrega que não vem.

**Why P1**: É o fim dos dois caminhos de falha do fluxo (ADR-0004): sem ele o marketplace segue com o pedido aberto.

**Acceptance Criteria**:

1. WHEN chega `order.order.cancelled.v1` com `marketplace` e `externalOrderId` THEN o gateway SHALL cancelar esse pedido no marketplace indicado, no formato dele (`POST .../cancellation` na Amazon, `PUT /orders/{id}` com `status: cancelled` no Mercado Livre, `POST cancel_order` na Shopee). (`MKTORD-16`)
2. WHEN o motivo do cancelamento é `MARKETPLACE_CANCELLED` THEN o gateway SHALL não chamar o marketplace. (`MKTORD-17`)
3. IF a mensagem está fora do contrato (JSON inválido, `orderId` que não é UUID, `marketplace` desconhecido ou ausente, `externalOrderId` ausente) THEN o consumer SHALL enviá-la a `marketplace.order-cancelled.dlq`. (`MKTORD-18`)
4. IF o marketplace recusa o cancelamento THEN o consumer SHALL enviar a mensagem à DLQ, com o motivo da recusa. (`MKTORD-19`)
5. IF o marketplace está indisponível depois das tentativas THEN o consumer SHALL relançar o erro, para o Kafka reentregar a mensagem. (`MKTORD-20`)
6. WHEN a mesma mensagem (mesmo `ce_id`) chega de novo THEN o consumer SHALL não cancelar o pedido de novo. (`MKTORD-21`)

**Independent Test**: Publicar `order.order.cancelled.v1` com `marketplace: SHOPEE` e `externalOrderId` no Kafka UI faz o WireMock receber `POST /shopee/api/v2/order/cancel_order` (veja `GET /__admin/requests`).

---

### P1: Chamadas resilientes aos marketplaces ⭐ MVP

**User Story**: Como operador, quero que o gateway aguente o marketplace lento, limitando a taxa ou fora do ar, sem derrubar os outros marketplaces.

**Why P1**: A #21 e a #33 reaproveitam a mesma política, e a demo mostra a falha de um marketplace.

**Acceptance Criteria**:

1. IF uma chamada ao marketplace dá timeout de 3 s, erro de conexão, `429` ou `5xx` THEN o gateway SHALL tentar de novo, até 3 tentativas no total, com espera exponencial e jitter. (`MKTRES-01`)
2. IF a resposta é `429` com `Retry-After` THEN o gateway SHALL esperar pelo menos o `Retry-After`, limitado a 5 s. (`MKTRES-02`)
3. IF a resposta é um `4xx` diferente de `429`, ou um erro de negócio dentro do `200` da Shopee, THEN o gateway SHALL não tentar de novo e SHALL falhar como recusa definitiva. (`MKTRES-03`)
4. IF as tentativas se esgotam THEN o gateway SHALL falhar com o último motivo e o número de tentativas feitas. (`MKTRES-04`)
5. WHEN 5 chamadas seguidas a um marketplace falham por indisponibilidade THEN o circuit breaker desse marketplace SHALL abrir. (`MKTRES-05`)
6. WHILE o circuit breaker de um marketplace está aberto, o gateway SHALL falhar na hora cada chamada a ele, sem chamar o marketplace e com 0 tentativas. (`MKTRES-06`)
7. WHEN o circuit breaker aberto completa 30 s THEN o gateway SHALL deixar passar uma chamada, fechando o breaker se ela der certo e reabrindo-o se falhar. (`MKTRES-07`)
8. WHILE o circuit breaker de um marketplace está aberto, o gateway SHALL seguir chamando os outros marketplaces. (`MKTRES-08`)
9. WHEN o marketplace responde, mesmo com uma recusa definitiva, THEN o gateway SHALL contar a chamada como sucesso para o circuit breaker. (`MKTRES-09`)
10. WHEN uma chamada dá certo THEN o gateway SHALL zerar a contagem de falhas seguidas. (`MKTRES-10`)

**Independent Test**: `scripts/simulate-failure.sh shopee unavailable` e, nos logs, 3 tentativas por consulta e, depois de 2 consultas, `circuit open`; Amazon e Mercado Livre seguem consultando. `scripts/simulate-failure.sh shopee off` e, em até 30 s, a Shopee volta.

---

### P2: Configuração dos marketplaces e do polling

**User Story**: Como integrante do time, quero configurar as URLs dos marketplaces e os tempos só por variável de ambiente, com padrões que funcionam contra o WireMock local.

**Why P2**: Os padrões bastam para a demo, mas o compose e os testes trocam as URLs.

**Acceptance Criteria**:

1. WHEN as variáveis de ambiente não estão definidas THEN `loadConfig` SHALL devolver `AMAZON_BASE_URL` `http://localhost:8089/amazon` com `AMAZON_MARKETPLACE_ID` `A2Q3Y263D00KWC`, `MERCADO_LIVRE_BASE_URL` `http://localhost:8089/mercadolivre` com `MERCADO_LIVRE_SELLER_ID` `2000`, `SHOPEE_BASE_URL` `http://localhost:8089/shopee` com `SHOPEE_SHOP_ID` `1001`, timeout de 3000 ms, 3 tentativas, espera de 200 ms a 2000 ms, breaker de 5 falhas e 30 000 ms, polling de 5000 ms com 60 000 ms de sobreposição e 86 400 000 ms de janela inicial, e os tópicos `order.order.cancelled.v1` e `marketplace.order-cancelled.dlq`. (`MKTORD-22`)
2. WHEN as variáveis de ambiente estão definidas THEN `loadConfig` SHALL devolver os valores delas no lugar dos padrões. (`MKTORD-23`)
3. IF uma variável numérica não é um inteiro maior que zero, ou a URL de um marketplace não é uma URL, THEN `loadConfig` SHALL falhar com `Invalid <NOME>: <valor>`. (`MKTORD-24`)

**Independent Test**: Subir com `MARKETPLACE_TIMEOUT_MS=abc` termina com código 1 e `Invalid MARKETPLACE_TIMEOUT_MS: abc`.

---

## Requirement Traceability

Caminhos relativos a `marketplace-gateway/src/`.

| Requirement ID | Story | Phase | Status | Evidência |
| --- | --- | --- | --- | --- |
| MKTORD-01 | P1: Receber os pedidos dos marketplaces | - | Implementing | `core/order/order.facade.spec.ts`, `infra/polling/order-pollers.spec.ts` |
| MKTORD-02 | P1: Receber os pedidos dos marketplaces | - | Implementing | `core/order/order.facade.spec.ts` |
| MKTORD-03 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/persistence/knex-marketplace-order.repository.int.spec.ts` |
| MKTORD-04 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/persistence/knex-marketplace-order.repository.int.spec.ts`, `core/order/order.facade.spec.ts` |
| MKTORD-05 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/persistence/knex-marketplace-order.repository.int.spec.ts` |
| MKTORD-06 | P1: Receber os pedidos dos marketplaces | - | Implementing | `core/order/order.facade.spec.ts`, `infra/persistence/knex-order-cursor.repository.int.spec.ts` |
| MKTORD-07 | P1: Receber os pedidos dos marketplaces | - | Implementing | `core/order/order.facade.spec.ts`, `infra/polling/order-pollers.spec.ts` |
| MKTORD-08 | P1: Receber os pedidos dos marketplaces | - | Implementing | `core/order/model/marketplace-order.entity.spec.ts`, `core/order/order.facade.spec.ts`, `infra/marketplace/amazon.marketplace.spec.ts` |
| MKTORD-09 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/messaging/order.integration-events.spec.ts`, `infra/order.module.int.spec.ts` |
| MKTORD-10 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTORD-11 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTORD-12 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/shopee.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTORD-13 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/marketplace-adapters.int.spec.ts` (journal do WireMock) |
| MKTORD-14 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts` |
| MKTORD-15 | P1: Receber os pedidos dos marketplaces | - | Implementing | `infra/marketplace/amazon.marketplace.spec.ts`, `infra/marketplace/mercado-livre.marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts` |
| MKTORD-16 | P1: Cancelar o pedido no marketplace | - | Implementing | `core/order/order.facade.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts`, `infra/messaging/order-cancelled.consumer.spec.ts` |
| MKTORD-17 | P1: Cancelar o pedido no marketplace | - | Implementing | `core/order/order.facade.spec.ts` |
| MKTORD-18 | P1: Cancelar o pedido no marketplace | - | Implementing | `infra/messaging/order-cancelled.consumer.spec.ts` |
| MKTORD-19 | P1: Cancelar o pedido no marketplace | - | Implementing | `infra/messaging/order-cancelled.consumer.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTORD-20 | P1: Cancelar o pedido no marketplace | - | Implementing | `infra/messaging/order-cancelled.consumer.spec.ts` |
| MKTORD-21 | P1: Cancelar o pedido no marketplace | - | Implementing | `infra/messaging/order-cancelled.consumer.spec.ts`, `infra/persistence/knex-inbox.repository.int.spec.ts` |
| MKTORD-22 | P2: Configuração dos marketplaces e do polling | - | Implementing | `infra/config/env.spec.ts` |
| MKTORD-23 | P2: Configuração dos marketplaces e do polling | - | Implementing | `infra/config/env.spec.ts` |
| MKTORD-24 | P2: Configuração dos marketplaces e do polling | - | Implementing | `infra/config/env.spec.ts` |
| MKTRES-01 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts`, `infra/marketplace/marketplace-http.client.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` (flaky, throttled, slow) |
| MKTRES-02 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts`, `infra/marketplace/marketplace-http.client.spec.ts` |
| MKTRES-03 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts`, `infra/marketplace/shopee.marketplace.spec.ts`, `infra/marketplace/marketplace-adapters.int.spec.ts` |
| MKTRES-04 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-05 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/circuit-breaker.spec.ts`, `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-06 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-07 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/circuit-breaker.spec.ts`, `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-08 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-09 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/resilient-marketplace.spec.ts` |
| MKTRES-10 | P1: Chamadas resilientes aos marketplaces | - | Implementing | `infra/marketplace/circuit-breaker.spec.ts`, `infra/marketplace/resilient-marketplace.spec.ts` |

**Coverage:** 34 total, 34 mapped to tests, 0 unmapped.

---

## Success Criteria

- [ ] `scripts/simulate-order.sh all` produz 3 mensagens em `marketplace.order.received.v1` em até 5 s, e repetir o `--id` não produz outra.
- [ ] `scripts/simulate-failure.sh shopee unavailable` não atrasa a consulta de Amazon e Mercado Livre.
- [ ] `npm test` passa, e o workflow `marketplace-gateway` fica verde no PR.
