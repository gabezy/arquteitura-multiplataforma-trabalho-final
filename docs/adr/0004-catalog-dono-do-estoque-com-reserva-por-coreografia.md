# ADR-0004: catalog-service como dono do estoque, com reserva no pedido por coreografia

## Status

`Proposto`

**Data:** 2026-10-23
**Autor:** Rodrigo Pretes Maia

## Contexto

- **Conflito:** o C4 coloca o estoque no `order-service`, mas o estoque já nasce e vive no `catalog-service` (`ProductEntity.stock`, importação por xlsx, estoque inicial em `catalog.product.created.v1`). Sem decisão, os dois serviços divergem.
- **Fluxo do pedido:** pedidos chegam por evento (`marketplace.order.received.v1`, do `marketplace-gateway`), e a cobrança (`billing-service`) e os anúncios dependem do resultado da reserva.
- **Padrão do projeto:** o fluxo catalog ↔ compliance já é coreografia por Kafka com outbox (ADR-0002), inbox e DLQ.
- **Estado atual:** a reserva no catalog já está em `dev` (#30, PR #44): idempotente por `orderId`, tudo ou nada por pedido, lock otimista em `products.version`. O `order-service` ainda não existe.
- **Prazo:** demo em 28/10 e entrega em 11/11, com 7 integrantes, cada um dono de um serviço.

## Decisão

O `catalog-service` continua dono do estoque e reserva ou devolve unidades reagindo aos eventos do pedido (saga por coreografia), para manter uma única fonte da verdade do estoque no serviço onde ele nasce.

- O `order-service` persiste o pedido e publica `order.order.placed.v1` (`orderId`, itens com `sku` e `quantity`) via outbox.
- O catalog responde com `catalog.stock.reserved.v1` (baixou tudo) ou `catalog.stock.insufficient.v1` (não baixou nada) e publica `catalog.product.stock-changed.v1` para os anúncios.
- Com `reserved`, o `order-service` confirma o pedido e publica `order.order.confirmed.v1`; o billing só cobra a partir dele.
- Com `insufficient`, o `order-service` cancela o pedido e publica `order.order.cancelled.v1` com `reason: OUT_OF_STOCK`; o `marketplace-gateway` cancela o pedido no marketplace.
- Qualquer cancelamento posterior (ex.: pagamento recusado) publica `order.order.cancelled.v1`, e o catalog devolve o estoque.
- Não há expiração de reserva nem timeout de resposta: o pedido aguarda a resposta do catalog, garantida pela entrega at-least-once com outbox.

## Alternativas consideradas

| Alternativa | Prós | Contras |
|---|---|---|
| **Catalog dono, coreografia** (escolhida) | Uma fonte do estoque; pedido entra mesmo com o catalog fora do ar; já implementado na #30; mesmo padrão do compliance | Consistência eventual; fluxo espalhado entre serviços |
| Order-service dono do estoque | Estoque perto do pedido; reserva sem ida e volta pelo Kafka | Estoque nasce no catalog: duas cópias sincronizadas por evento; desfaz a #30 com o order-service ainda inexistente antes de 28/10 |
| Reserva síncrona via REST no catalog | Resposta imediata; fluxo fácil de seguir | Catalog fora do ar impede a entrada do pedido; retry e timeout por HTTP sem idempotência nativa; mistura REST com a entrada por evento |
| Saga orquestrada pelo order-service | Passos e compensações explícitos em um lugar só | Orquestrador, comandos e estado da saga a implementar para só 2 passos (estoque e cobrança); foge da coreografia já usada |

## Consequências

**Positivas:**
- Uma única fonte da verdade do estoque; o `order-service` não guarda saldo.
- O lado do catalog já está pronto; o `order-service` só publica e consome eventos.
- Redelivery não baixa nem devolve estoque duas vezes, e pedido com vários itens nunca fica reservado pela metade.
- Cobrança só depois do estoque garantido: não há estorno por falta de estoque.

**Negativas:**
- Consistência eventual: entre a baixa e o `stock-changed` chegar aos anúncios, outro marketplace pode vender a última unidade, e o pedido é cancelado.
- Sem timeout, um pedido cujo `placed` nunca é respondido fica aguardando reserva; isso precisa ser monitorado (dashboard e DLQ `catalog.order-stock.dlq`).
- O `order-service` precisa de outbox e de consumidor idempotente próprios.
- O fluxo fica distribuído entre 4 serviços: entender um pedido exige trace distribuído (OTel) e o catálogo de eventos (#8).
- O C4 precisa ser corrigido (#13), tirando o estoque do `order-service`.

## Referências

- Richardson, C. (2018). *Microservices Patterns*. Manning. Cap. 4 — Managing transactions with sagas (coreografia × orquestração).
- Richardson, C. *Pattern: Saga*. microservices.io.
- Garcia-Molina, H.; Salem, K. (1987). *Sagas*. ACM SIGMOD.
- Apache Kafka Docs. *Message Delivery Semantics*. kafka.apache.org.
