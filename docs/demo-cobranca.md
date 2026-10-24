# Demo: cobrança do pedido confirmado

O billing-service consome `order.order.confirmed.v1`, cria uma fatura por pedido com a comissão do marketplace, cobra a fatura num PSP simulado e publica o resultado (ADR-0005, ADR-0007). Ele também consome `order.order.cancelled.v1`: cancela a fatura que ainda não foi paga, ou guarda o cancelamento quando o pedido ainda não tem fatura. Enquanto o order-service não publica esses eventos, eles são publicados à mão.

| Evento | Chave | Quando |
|---|---|---|
| `billing.invoice.issued.v1` | `invoiceId` | uma fatura nasceu (publicado pelo billing) |
| `billing.payment.confirmed.v1` | `invoiceId` | o PSP confirmou o pagamento |
| `billing.payment.failed.v1` | `invoiceId` | o PSP recusou a cobrança |
| `billing.order-events.dlq` | a da mensagem original | uma mensagem de pedido nunca vai ser processada (contrato quebrado ou total que não bate) |

As taxas de comissão são 12% na Amazon, 11% no Mercado Livre e 14% na Shopee. Elas mudam por `COMMISSION_AMAZON_PERCENT`, `COMMISSION_MERCADO_LIVRE_PERCENT` e `COMMISSION_SHOPEE_PERCENT`.

O PSP é o WireMock do compose (`docker/wiremock/mappings/psp.json`): responde `201 PENDING` à cobrança e, 2 s depois, chama o webhook do billing. Uma cobrança de R$ 100.000,00 ou mais termina em `FAILED` com `INSUFFICIENT_FUNDS`, e uma abaixo disso termina em `PAID`.

## Preparação

Na raiz do repositório:

```bash
make up
curl -s localhost:8086/health        # {"status":"UP"}
```

O consumer leva uns 20 s depois da subida para entrar no grupo do Kafka, então o primeiro pedido demora um pouco para aparecer.

Funções para publicar os eventos (a mensagem leva os headers CloudEvents, como o order-service vai publicar):

```bash
order_event() { # order_event <tópico> <ce_id> <orderId> <json>
  printf 'ce_specversion:1.0,ce_id:%s,ce_source:/order-service,ce_type:%s\t%s|%s\n' "$2" "$1" "$3" "$4" |
    docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 --topic "$1" \
      --reader-property parse.key=true --reader-property key.separator='|' --reader-property parse.headers=true
}
invoices() { curl -s "localhost:8086/invoices?orderId=$1" | jq -c '.invoices[] | {id, status, amount, commissionPercent, commissionAmount, netAmount, pspTransactionId, failureReason, paidAt, failedAt}'; }
topic() { # topic <tópico>: o que já foi publicado nele
  docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --topic "$1" \
    --from-beginning --timeout-ms 5000 --property print.key=true 2>/dev/null
}
CONFIRMED=order.order.confirmed.v1
```

Também dá para publicar pelo Kafka UI (http://localhost:8090), em *Topics → order.order.confirmed.v1 → Produce Message*, com os headers `ce_*`.

## Roteiro

1. **Pedido aprovado**: 1 iPhone no Mercado Livre vira uma fatura `ISSUED`, com 11% de comissão (R$ 1.650,00) e R$ 13.350,00 para a loja. Em uns 3 s o PSP confirma e a fatura fica `PAID`, com o id da cobrança.

   ```bash
   ORDER=6f1c2b8e-0000-4000-8000-000000000001
   order_event $CONFIRMED evt-1 $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   sleep 5; invoices $ORDER
   topic billing.payment.confirmed.v1
   ```

2. **Pedido recusado**: 7 iPhones na Shopee somam R$ 105.000,00, que o PSP recusa por falta de saldo. A fatura fica `PAYMENT_FAILED` com o motivo, e o billing publica `billing.payment.failed.v1` para o order-service cancelar o pedido.

   ```bash
   REFUSED=6f1c2b8e-0000-4000-8000-000000000002
   order_event $CONFIRMED evt-2 $REFUSED '{"orderId":"'$REFUSED'","marketplace":"SHOPEE","externalOrderId":"SP-2000002","items":[{"sku":"231","quantity":7,"unitPrice":15000.00}],"total":105000.00}'
   sleep 5; invoices $REFUSED
   topic billing.payment.failed.v1
   ```

3. **Reentrega**: a mesma mensagem, ou outra mensagem do mesmo pedido, não cria uma segunda fatura nem cobra de novo.

   ```bash
   order_event $CONFIRMED evt-1 $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   order_event $CONFIRMED evt-1b $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   invoices $ORDER      # continua uma fatura só, PAID
   ```

4. **Mensagem inválida**: o total não bate com os itens, então a mensagem vai para a DLQ com o motivo.

   ```bash
   BAD=6f1c2b8e-0000-4000-8000-000000000003
   order_event $CONFIRMED evt-3 $BAD '{"orderId":"'$BAD'","marketplace":"AMAZON","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":1.00}'
   docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --topic billing.order-events.dlq \
     --from-beginning --timeout-ms 5000 --property print.headers=true --property print.key=true
   ```

5. **Cancelamento antes da confirmação**: o pedido chegou cancelado primeiro (o Kafka não ordena entre tópicos), então a confirmação que vem depois não gera fatura.

   ```bash
   LATE=6f1c2b8e-0000-4000-8000-000000000004
   order_event order.order.cancelled.v1 evt-4 $LATE '{"orderId":"'$LATE'","reason":"OUT_OF_STOCK"}'
   order_event $CONFIRMED evt-5 $LATE '{"orderId":"'$LATE'","marketplace":"SHOPEE","items":[{"sku":"412","quantity":1,"unitPrice":9000.00}],"total":9000.00}'
   invoices $LATE       # nenhuma fatura
   ```

6. **PSP fora do ar**: com o stub de queda carregado, o PSP responde `503`. A fatura não falha: fica `ISSUED`, o billing tenta de novo com espera crescente, e depois de 5 tentativas seguidas com falha o circuito abre por 30 s e o billing nem chama o PSP. Enquanto a fatura não é paga, o cancelamento do pedido ainda a cancela.

   ```bash
   curl -s -X POST localhost:8089/__admin/mappings -H 'Content-Type: application/json' -d @docker/wiremock/scenarios/psp-outage.json
   DOWN=6f1c2b8e-0000-4000-8000-000000000005
   order_event $CONFIRMED evt-6 $DOWN '{"orderId":"'$DOWN'","marketplace":"AMAZON","externalOrderId":"AZ-2000005","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   sleep 20; invoices $DOWN      # ISSUED
   docker logs billing-service 2>&1 | grep -E 'attempt failed|circuit|unavailable'

   # o pedido é cancelado antes de o PSP voltar
   order_event order.order.cancelled.v1 evt-7 $DOWN '{"orderId":"'$DOWN'","reason":"CUSTOMER_REQUEST"}'
   sleep 3; invoices $DOWN       # CANCELLED
   ```

   Outro pedido, feito durante a queda, é cobrado quando o PSP volta. Ao remover o stub, o circuito testa o PSP assim que seus 30 s acabam, e a fatura é cobrada na tentativa seguinte (em geral em menos de 1 minuto).

   ```bash
   WAIT=6f1c2b8e-0000-4000-8000-000000000006
   order_event $CONFIRMED evt-8 $WAIT '{"orderId":"'$WAIT'","marketplace":"AMAZON","externalOrderId":"AZ-2000006","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   sleep 5; invoices $WAIT       # ISSUED
   curl -s -X DELETE localhost:8089/__admin/mappings/8b3d9a52-7e1c-4a0e-9a41-5d3f6c2e0b01
   sleep 60; invoices $WAIT      # PAID
   ```

7. **Webhook perdido**: se o PSP não consegue chamar o webhook, a fatura fica `PAYMENT_PENDING`. A conciliação consulta o PSP a cada 30 s pelas cobranças pendentes há mais de 60 s e aplica o resultado, como o webhook faria.

   ```bash
   PSP_CALLBACK_URL=http://localhost:9/webhooks/psp docker compose up -d billing-service   # um endereço que ninguém atende
   LOST=6f1c2b8e-0000-4000-8000-000000000007
   order_event $CONFIRMED evt-9 $LOST '{"orderId":"'$LOST'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000007","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   sleep 20; invoices $LOST      # PAYMENT_PENDING
   sleep 100; invoices $LOST     # PAID, em menos de 2 minutos
   docker logs billing-service 2>&1 | grep reconciled
   docker compose up -d billing-service    # volta ao webhook de verdade
   ```

Para ver os eventos publicados no Kafka:

```bash
topic billing.invoice.issued.v1
topic billing.payment.confirmed.v1
topic billing.payment.failed.v1
```

## Regras

- Uma fatura por pedido (`orderId` único), mesmo com reentrega ou com duas confirmações ao mesmo tempo.
- O total da fatura é a soma de quantidade × preço unitário dos itens; o `total` do evento precisa bater.
- A comissão é o total × a taxa do marketplace, arredondada para cima no centavo; o líquido é o total menos a comissão.
- Mensagem fora do contrato (header `ce_*` faltando, JSON inválido, `orderId` que não é UUID, marketplace desconhecido, itens fora dos limites, total que não bate) vai para `billing.order-events.dlq`.
- Erro passageiro (banco ou Kafka fora do ar) não vai para a DLQ: o billing repete a mensagem, com espera de 1 s dobrando até 30 s, e só avança o offset depois de processar.
- Um worker cobra, a cada 2 s, a fatura `ISSUED` mais antiga que já pode ser cobrada, com `Idempotency-Key` igual ao id da fatura. O consumer de pedidos nunca espera o PSP.
- Falha do PSP (timeout de 3 s, conexão recusada, `5xx` ou `429`) é tentada até 3 vezes, com 200 ms e depois 400 ms de espera. Se todas falham, a fatura continua `ISSUED` e a próxima tentativa é daqui a min(2^tentativas, 60) s. Cinco tentativas seguidas com falha abrem o circuito por 30 s.
- Só a recusa do PSP (`422` na criação ou `FAILED` no webhook) leva a fatura a `PAYMENT_FAILED`.
- O webhook `POST /webhooks/psp` exige `X-PSP-Token`, é idempotente (o mesmo resultado de novo é `204` e não publica nada) e responde `409` ao resultado que contradiz a fatura.
- Fatura `PAID`, `PAYMENT_FAILED` ou `CANCELLED` não muda com um cancelamento (não há estorno).
