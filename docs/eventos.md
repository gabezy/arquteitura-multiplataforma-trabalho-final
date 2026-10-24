# Catálogo de eventos e contratos

Contratos entre os serviços do omni-market. Esta versão nasceu da #11 (billing-service) e traz as convenções, o índice dos tópicos que existem hoje e o detalhe dos eventos de cobrança. O restante do catálogo é da #8: veja "O que a #8 ainda completa" no fim.

## Convenções

- **CloudEvents em binary mode.** Os atributos vão nos headers `ce_*` do Kafka e o valor da mensagem é o JSON do `data`. O header `traceparent` leva o trace.
- **Nome do tópico e do tipo:** `<serviço>.<agregado>.<evento>.vN`. A exceção é `produto.analisado.v1`, que já existia.
- **Chave da mensagem:** o id do agregado (`orderId`, `invoiceId`, `productId`).
- **Entrega at-least-once.** O produtor usa outbox (ADR-0002) e o consumidor é idempotente, com inbox por `ce_id` (`processed_events`).
- **Uma DLQ por consumidor**, com retenção de 14 dias. A mensagem original segue com key, value e headers, mais `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset` e `dlq-reason`.
- **Dinheiro:** número JSON com duas casas decimais (`15000.00`) e moeda `BRL`. Cada serviço guarda o valor em centavos inteiros. Entre o billing e o PSP o valor vai em centavos (`1500000`).
- **Datas:** RFC 3339 em UTC.

Headers de uma mensagem de cobrança:

```text
ce_specversion: 1.0
ce_id:          5b0c1f3e-6d0a-4c52-9a53-0d0a7f4f3b11   (uuid do evento, usado pelo inbox)
ce_source:      /billing-service
ce_type:        billing.invoice.issued.v1
ce_subject:     <invoiceId>
ce_time:        2026-10-24T12:00:01Z
content-type:   application/json
traceparent:    00-<trace-id>-<span-id>-01
```

## Tópicos hoje

| Tópico | Produtor | Consumidores | Chave | DLQ do consumidor |
|---|---|---|---|---|
| `catalog.product.created.v1` | catalog-service | compliance-service | `productId` | `compliance.product-created.dlq` |
| `produto.analisado.v1` | compliance-service | catalog-service | `productId` | `catalog.product-analysis.dlq` |
| `catalog.product.approved.v1`, `catalog.product.rejected.v1` | catalog-service | marketplace-gateway (previsto no ADR-0002) | `productId` | a definir |
| `catalog.stock.reserved.v1`, `catalog.stock.insufficient.v1` | catalog-service | order-service (#20, #29) | `orderId` | a definir |
| `catalog.product.stock-changed.v1` | catalog-service | marketplace-gateway (#33) | `productId` | a definir |
| `order.order.placed.v1` | order-service | catalog-service | `orderId` | `catalog.order-stock.dlq` |
| `order.order.confirmed.v1` (proposta) | order-service | billing-service | `orderId` | `billing.order-events.dlq` |
| `order.order.cancelled.v1` | order-service | catalog-service, billing-service | `orderId` | `catalog.order-stock.dlq`, `billing.order-events.dlq` |
| `billing.invoice.issued.v1` | billing-service | nenhum hoje (consulta pela API) | `invoiceId` | - |
| `billing.payment.confirmed.v1` | billing-service | order-service | `invoiceId` | a definir |
| `billing.payment.failed.v1` | billing-service | order-service | `invoiceId` | a definir |

## Eventos de cobrança

### `order.order.confirmed.v1` (proposta, consumido pelo billing)

O order-service publica quando o catalog responde `catalog.stock.reserved.v1` (ADR-0004). O billing só cobra a partir dele. O contrato abaixo é uma proposta do billing e precisa do aceite do dono do order-service (#20).

```json
{
  "orderId": "6f1c2b8e-0000-4000-8000-000000000001",
  "marketplace": "MERCADO_LIVRE",
  "externalOrderId": "ML-2000001",
  "currency": "BRL",
  "items": [{ "sku": "231", "quantity": 1, "unitPrice": 15000.00 }],
  "confirmedAt": "2026-10-24T12:00:00Z"
}
```

| Campo | Regra |
|---|---|
| `orderId` | UUID, obrigatório; é a chave da mensagem e o id do pedido no billing (uma fatura por pedido) |
| `marketplace` | `AMAZON`, `MERCADO_LIVRE` ou `SHOPEE` |
| `externalOrderId` | opcional; id do pedido no marketplace |
| `currency` | `BRL` |
| `items` | de 1 a 100 itens; `sku` não vazio; `quantity` de 1 a 10 000; `unitPrice` de 0.01 a 1 000 000.00 |
| `confirmedAt` | RFC 3339 |

### `order.order.cancelled.v1` (já usado pelo catalog)

```json
{ "orderId": "6f1c2b8e-0000-4000-8000-000000000001", "reason": "PAYMENT_FAILED" }
```

O billing cancela a fatura que ainda não foi paga (`ISSUED` ou `PAYMENT_PENDING`). Se a fatura ainda não existe, registra o cancelamento, e uma confirmação que chegar depois não gera fatura. Uma fatura `PAID`, `PAYMENT_FAILED` ou `CANCELLED` não muda (não há estorno).

### `billing.invoice.issued.v1`

Publicado quando a fatura nasce. A comissão vem da taxa do marketplace (ADR-0005).

```json
{
  "invoiceId": "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10",
  "orderId": "6f1c2b8e-0000-4000-8000-000000000001",
  "externalOrderId": "ML-2000001",
  "marketplace": "MERCADO_LIVRE",
  "currency": "BRL",
  "totalAmount": 15000.00,
  "commissionPercent": 11.00,
  "commissionAmount": 1650.00,
  "netAmount": 13350.00,
  "issuedAt": "2026-10-24T12:00:01Z"
}
```

### `billing.payment.confirmed.v1`

Publicado quando o PSP confirma o pagamento.

```json
{
  "invoiceId": "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10",
  "orderId": "6f1c2b8e-0000-4000-8000-000000000001",
  "pspChargeId": "ch_paid_0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10",
  "amount": 15000.00,
  "currency": "BRL",
  "paidAt": "2026-10-24T12:00:04Z"
}
```

### `billing.payment.failed.v1`

Publicado quando o PSP recusa a cobrança. O order-service cancela o pedido e publica `order.order.cancelled.v1` com `reason: PAYMENT_FAILED`, e o catalog devolve o estoque (ADR-0004).

```json
{
  "invoiceId": "7c4d1e90-2b7f-4f0e-9a3c-51c0f4d8e6a2",
  "orderId": "6f1c2b8e-0000-4000-8000-000000000002",
  "pspChargeId": "ch_failed_7c4d1e90-2b7f-4f0e-9a3c-51c0f4d8e6a2",
  "amount": 105000.00,
  "currency": "BRL",
  "reason": "INSUFFICIENT_FUNDS",
  "failedAt": "2026-10-24T12:05:04Z"
}
```

### `billing.order-events.dlq`

DLQ do consumidor de pedidos do billing, para `order.order.confirmed.v1` e `order.order.cancelled.v1`. Vai para ela a mensagem que nunca vai ser processada: falta header `ce_*` obrigatório, JSON inválido, `ce_type` inesperado para o tópico, `orderId` que não é UUID, marketplace desconhecido, moeda diferente de `BRL` e itens fora dos limites. Erro transitório (banco ou Kafka fora do ar) não vai para a DLQ: o billing repete a mesma mensagem, com espera de 1 s dobrando até 30 s, e só confirma o offset depois de processar.

## Contrato do PSP (simulado)

O billing cobra pelo PSP de forma assíncrona: pede a cobrança e recebe o resultado por webhook, com consulta de status como reserva. No ambiente local o PSP é o WireMock (`http://wiremock:8080`, na máquina `http://localhost:8089`). A decisão está na ADR-0007.

### Criar a cobrança

```http
POST /psp/v1/charges
Content-Type: application/json
Idempotency-Key: 0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10

{
  "reference": "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10",
  "amount": 1500000,
  "currency": "BRL",
  "description": "Pedido 6f1c2b8e-0000-4000-8000-000000000001 (MERCADO_LIVRE)",
  "callbackUrl": "http://billing-service:8086/webhooks/psp"
}
```

- `Idempotency-Key` e `reference` são o `invoiceId`. Repetir a chamada não cria outra cobrança.
- `amount` em centavos.

Respostas:

```http
201 Created
{ "id": "ch_paid_0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10", "reference": "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10", "status": "PENDING" }

422 Unprocessable Entity
{ "code": "AMOUNT_NOT_ALLOWED" }
```

O `201` aceita a cobrança, e o resultado chega pelo webhook. O `422` é uma recusa na criação: o billing marca a fatura como `PAYMENT_FAILED`. Timeout, falha de conexão, `429` e `5xx` são tratados como indisponibilidade: 3 tentativas com espera crescente e circuit breaker (ADR-0007).

### Webhook de resultado

O PSP chama o `callbackUrl` com o token compartilhado.

```http
POST /webhooks/psp
Content-Type: application/json
X-PSP-Token: <PSP_WEBHOOK_TOKEN>

{
  "chargeId": "ch_failed_7c4d1e90-2b7f-4f0e-9a3c-51c0f4d8e6a2",
  "reference": "7c4d1e90-2b7f-4f0e-9a3c-51c0f4d8e6a2",
  "status": "FAILED",
  "failureReason": "INSUFFICIENT_FUNDS",
  "occurredAt": "2026-10-24T12:05:04Z"
}
```

`status` é `PAID` ou `FAILED`. `failureReason` é `null` quando pago.

| Resposta do billing | Quando |
|---|---|
| `204` | resultado aplicado, ou o mesmo resultado repetido |
| `400` | corpo inválido |
| `401` | `X-PSP-Token` ausente ou errado |
| `404` | `reference` desconhecida |
| `409` | resultado contradiz o estado final da fatura ou o `chargeId` já guardado |

### Consultar a cobrança

Usada na conciliação, para fatura `PAYMENT_PENDING` há mais de 60 s.

```http
GET /psp/v1/charges/ch_paid_0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10

200 OK
{ "id": "ch_paid_0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10", "reference": "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10", "status": "PAID", "failureReason": null }
```

`status` é `PENDING`, `PAID` ou `FAILED`.

### Comportamento do simulador

- Cobrança de R$ 100.000,00 ou mais (`amount` ≥ 10 000 000): responde `201` e, 2 s depois, chama o webhook com `FAILED` e `INSUFFICIENT_FUNDS`.
- Cobrança abaixo disso: responde `201` e, 2 s depois, chama o webhook com `PAID`.
- O simulador não guarda estado. Ele codifica o resultado no id da cobrança (`ch_paid_…` ou `ch_failed_…`) para responder à consulta, e o billing trata o id como opaco.
- Na demo, 1 iPhone (R$ 15.000,00) é aprovado e 7 iPhones (R$ 105.000,00) são recusados.

## Chamadas REST

| Origem | Destino | Chamada |
|---|---|---|
| bff-gateway | billing-service | `GET /invoices/{id}`, `GET /invoices?orderId=&status=&marketplace=&limit=&offset=` (#34) |
| billing-service | PSP | `POST /psp/v1/charges`, `GET /psp/v1/charges/{id}` |
| PSP | billing-service | `POST /webhooks/psp`, com `X-PSP-Token` |
| marketplace-gateway | catalog-service | `GET /products/sku/:sku` (previsto, #21) |

`GET /invoices/{id}` devolve a fatura com itens, valores (`totalAmount`, `commissionPercent`, `commissionAmount`, `netAmount`), `status` (`ISSUED`, `PAYMENT_PENDING`, `PAID`, `PAYMENT_FAILED` ou `CANCELLED`) e, quando houver, `pspChargeId`, `failureReason`, `paidAt` e `failedAt`. Erros usam `application/problem+json`. O formato completo está em `.specs/features/billing-service/design.md`.

## O que a #8 ainda completa

- Os contratos dos eventos de catálogo, compliance e estoque, com payload de exemplo (aqui só há o índice).
- Os eventos do marketplace-gateway (`marketplace.order.received.v1`, `marketplace.listing.published.v1` e `marketplace.listing.failed.v1`) e as DLQs dos consumidores marcados como "a definir".
- O diagrama de sequência do fluxo importação → compliance → anúncio → pedido → estoque → cobrança.
- O aceite dos donos dos serviços sobre os contratos propostos aqui, no gate do M1 (#19): `order.order.confirmed.v1` (Rodrigo) e os eventos `billing.*` consumidos pelo order-service.
- A criação dos tópicos em `docker/kafka/create-topics.sh`: o billing acrescenta os dele nas tarefas T17 e T23.
