# Demo: ciclo do pedido

O order-service (#20, #29) transforma cada venda dos marketplaces num pedido e o leva até o fim pela coreografia da [ADR-0004](adr/0004-catalog-dono-do-estoque-com-reserva-por-coreografia.md):

| Recebe | De | O pedido | Publica |
|---|---|---|---|
| `marketplace.order.received.v1` | marketplace-gateway | nasce `RECEIVED` | `order.order.placed.v1` (o catalog reserva o estoque) |
| `catalog.stock.reserved.v1` | catalog-service | `RECEIVED` → `CONFIRMED` | `order.order.confirmed.v1` (o billing cobra) |
| `catalog.stock.insufficient.v1` | catalog-service | `RECEIVED` → `CANCELLED(OUT_OF_STOCK)` | `order.order.cancelled.v1` |
| `billing.payment.confirmed.v1` | billing-service | `CONFIRMED` → `PAID` | nada |
| `billing.payment.failed.v1` | billing-service | `CONFIRMED` → `CANCELLED(PAYMENT_FAILED)` | `order.order.cancelled.v1` (o catalog devolve o estoque) |

O PSP simulado recusa uma cobrança de R$ 100.000,00 ou mais (`docs/demo-cobranca.md`).

## Preparação

Na raiz do repositório:

```bash
make compose-up
curl -s localhost:8084/health        # {"status":"UP"}
```

Os consumers levam uns 20 s depois da subida para entrar nos grupos do Kafka.

Crie um produto com 10 unidades. O compliance aprova sozinho quando a descrição tem 20 caracteres ou mais e o preço fica abaixo de R$ 100.000,00:

```bash
curl -s -X POST localhost:8082/products -H 'content-type: application/json' \
  -d '{"sku":"IPH-015","name":"iPhone 15","description":"iPhone 15 128GB, tela de 6,1 polegadas","price":15000,"stock":10}'
```

Funções para publicar com os headers CloudEvents que os consumers exigem e para acompanhar o resultado:

```bash
publish() { # publish <tópico> <ce_source> <ce_subject> <json>
  printf 'ce_specversion=1.0,ce_id=%s,ce_source=%s,ce_type=%s,ce_subject=%s,ce_time=%s,content-type=application/json\t%s|%s\n' \
    "$(cat /proc/sys/kernel/random/uuid)" "$2" "$1" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3" "$4" |
    docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 --topic "$1" \
      --reader-property parse.key=true --reader-property key.separator='|' \
      --reader-property parse.headers=true --reader-property headers.key.separator='='
}
sale() { # sale <marketplace> <externalOrderId> <sku> <quantity> <unitPrice>
  publish marketplace.order.received.v1 /marketplace-gateway "$1:$2" \
    "{\"marketplace\":\"$1\",\"externalOrderId\":\"$2\",\"items\":[{\"sku\":\"$3\",\"quantity\":$4,\"unitPrice\":$5}],\"total\":$(($4 * $5)),\"orderedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
}
orders() { curl -s "localhost:8084/orders?limit=10" | jq -c '.orders[] | {id, marketplace, externalOrderId, status, cancellationReason, total}'; }
stock() { curl -s localhost:8082/products/sku/IPH-015 | jq '.stock'; }
topic() { # topic <tópico>: o que já foi publicado nele
  docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --topic "$1" \
    --from-beginning --timeout-ms 5000 --property print.key=true 2>/dev/null
}
```

No dia a dia o marketplace-gateway publica as vendas que busca nos simuladores; `sale` faz o mesmo à mão.

## Roteiro

1. **Pedido pago**: 1 iPhone no Mercado Livre. O catalog reserva (10 → 9), o pedido fica `CONFIRMED`, o billing emite a fatura e, uns 3 s depois, o PSP aprova e o pedido fica `PAID`.

   ```bash
   sale MERCADO_LIVRE ML-2000001 IPH-015 1 15000
   sleep 8; orders; stock
   ```

2. **Pagamento recusado**: 7 iPhones na Shopee somam R$ 105.000,00. O estoque é reservado (9 → 2) e o pedido é confirmado, mas o PSP recusa. O pedido fica `CANCELLED` com `PAYMENT_FAILED`, e o catalog devolve o estoque (2 → 9).

   ```bash
   sale SHOPEE SHP-3000001 IPH-015 7 15000
   sleep 8; orders; stock
   topic order.order.cancelled.v1
   ```

3. **Sem estoque**: 50 iPhones na Amazon. O catalog responde `insufficient`, nada é baixado e o pedido fica `CANCELLED` com `OUT_OF_STOCK`.

   ```bash
   sale AMAZON AMZ-1000001 IPH-015 50 15000
   sleep 4; orders; stock
   ```

4. **Venda repetida**: o mesmo pedido do Mercado Livre chega de novo com outro `ce_id`. Continua havendo um pedido só, e o log diz `Marketplace order already exists`.

   ```bash
   sale MERCADO_LIVRE ML-2000001 IPH-015 1 15000
   sleep 3; orders
   ```

5. **Resposta atrasada ou contraditória**: um `insufficient` para o pedido já pago não muda nada. O log registra `Order outcome skipped` com o motivo, e nada vai para a DLQ.

   ```bash
   ID=$(curl -s 'localhost:8084/orders?marketplace=MERCADO_LIVRE' | jq -r '.orders[0].id')
   publish catalog.stock.insufficient.v1 /catalog-service "$ID" "{\"orderId\":\"$ID\",\"items\":[{\"sku\":\"IPH-015\",\"requested\":1,\"available\":0}]}"
   sleep 3; curl -s "localhost:8084/orders/$ID" | jq .status    # "PAID"
   docker logs order-service 2>&1 | grep 'Order outcome skipped' | tail -1
   ```

6. **Mensagem fora do contrato**: vai para a DLQ do grupo, com os headers `dlq-*`, e o consumer segue.

   ```bash
   publish catalog.stock.reserved.v1 /catalog-service 6f1c2b8e-0000-4000-8000-000000000001 '{}'
   sleep 3; topic order.stock-response.dlq
   ```

7. **Pela API do BFF e relatório**: com um token de `csm` (ver o `CLAUDE.md` da raiz), `GET /orders?status=PAID` mostra o pedido pago, e o relatório do dia conta só ele.

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" 'localhost:8080/orders?status=PAID' | jq -c '.orders[] | {externalOrderId, status}'
   curl -s "localhost:8084/reports/sales-by-marketplace?from=$(date -u +%F)&to=$(date -u +%F)" | jq -c .marketplaces
   ```

## Onde olhar

- Kafka UI (http://localhost:8090): os tópicos `order.order.*` e as DLQs `order.marketplace-order.dlq`, `order.stock-response.dlq` e `order.billing-payment.dlq`.
- Grafana (http://localhost:3000), em *Explore → Tempo*: cada consumer do order-service processa a mensagem dentro do trace que veio no `traceparent`, e os eventos que ele publica levam esse trace adiante.
