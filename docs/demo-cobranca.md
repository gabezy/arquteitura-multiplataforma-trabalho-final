# Demo: fatura a partir do pedido confirmado

O billing-service consome `order.order.confirmed.v1` e cria uma fatura por pedido, com a comissão do marketplace (ADR-0005). Ele também consome `order.order.cancelled.v1`: cancela a fatura que ainda não foi paga, ou guarda o cancelamento quando o pedido ainda não tem fatura. Enquanto o order-service não publica esses eventos, eles são publicados à mão.

| Evento | Chave | Quando |
|---|---|---|
| `billing.invoice.issued.v1` | `invoiceId` | uma fatura nasceu (publicado pelo billing) |
| `billing.order-events.dlq` | a da mensagem original | uma mensagem de pedido nunca vai ser processada (contrato quebrado ou total que não bate) |

As taxas de comissão são 12% na Amazon, 11% no Mercado Livre e 14% na Shopee. Elas mudam por `COMMISSION_AMAZON_PERCENT`, `COMMISSION_MERCADO_LIVRE_PERCENT` e `COMMISSION_SHOPEE_PERCENT`.

## Preparação

Na raiz do repositório:

```bash
make up
curl -s localhost:8086/health        # {"status":"UP"}
```

Funções para publicar os eventos (a mensagem leva os headers CloudEvents, como o order-service vai publicar):

```bash
order_event() { # order_event <tópico> <ce_id> <orderId> <json>
  printf 'ce_specversion:1.0,ce_id:%s,ce_source:/order-service,ce_type:%s\t%s|%s\n' "$2" "$1" "$3" "$4" |
    docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 --topic "$1" \
      --reader-property parse.key=true --reader-property key.separator='|' --reader-property parse.headers=true
}
invoices() { curl -s "localhost:8086/invoices?orderId=$1" | jq -c '.invoices[] | {id, status, amount, commissionPercent, commissionAmount, netAmount}'; }
```

Também dá para publicar pelo Kafka UI (http://localhost:8090), em *Topics → order.order.confirmed.v1 → Produce Message*, com os headers `ce_*`.

## Roteiro

1. **Pedido normal**: 1 iPhone no Mercado Livre vira uma fatura `ISSUED`, com 11% de comissão (R$ 1.650,00) e R$ 13.350,00 para a loja.

   ```bash
   CONFIRMED=order.order.confirmed.v1; ORDER=6f1c2b8e-0000-4000-8000-000000000001
   order_event $CONFIRMED evt-1 $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   invoices $ORDER
   ```

2. **Reentrega**: a mesma mensagem, ou outra mensagem do mesmo pedido, não cria uma segunda fatura nem publica de novo.

   ```bash
   order_event $CONFIRMED evt-1 $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   order_event $CONFIRMED evt-1b $ORDER '{"orderId":"'$ORDER'","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":15000.00}'
   invoices $ORDER      # continua uma fatura só
   ```

3. **Mensagem inválida**: o total não bate com os itens, então a mensagem vai para a DLQ com o motivo.

   ```bash
   BAD=6f1c2b8e-0000-4000-8000-000000000002
   order_event $CONFIRMED evt-2 $BAD '{"orderId":"'$BAD'","marketplace":"AMAZON","items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":1.00}'
   docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --topic billing.order-events.dlq \
     --from-beginning --timeout-ms 5000 --property print.headers=true --property print.key=true
   ```

4. **Cancelamento**: a fatura ainda não paga fica `CANCELLED`, com o motivo.

   ```bash
   order_event order.order.cancelled.v1 evt-3 $ORDER '{"orderId":"'$ORDER'","reason":"OUT_OF_STOCK"}'
   invoices $ORDER
   ```

5. **Cancelamento antes da confirmação**: o pedido chegou cancelado primeiro (o Kafka não ordena entre tópicos), então a confirmação que vem depois não gera fatura.

   ```bash
   LATE=6f1c2b8e-0000-4000-8000-000000000003
   order_event order.order.cancelled.v1 evt-4 $LATE '{"orderId":"'$LATE'","reason":"OUT_OF_STOCK"}'
   order_event $CONFIRMED evt-5 $LATE '{"orderId":"'$LATE'","marketplace":"SHOPEE","items":[{"sku":"412","quantity":1,"unitPrice":9000.00}],"total":9000.00}'
   invoices $LATE       # nenhuma fatura
   ```

Para ver as faturas emitidas no Kafka:

```bash
docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --topic billing.invoice.issued.v1 \
  --from-beginning --timeout-ms 5000 --property print.key=true
```

## Regras

- Uma fatura por pedido (`orderId` único), mesmo com reentrega ou com duas confirmações ao mesmo tempo.
- O total da fatura é a soma de quantidade × preço unitário dos itens; o `total` do evento precisa bater.
- A comissão é o total × a taxa do marketplace, arredondada para cima no centavo; o líquido é o total menos a comissão.
- Mensagem fora do contrato (header `ce_*` faltando, JSON inválido, `orderId` que não é UUID, marketplace desconhecido, itens fora dos limites, total que não bate) vai para `billing.order-events.dlq`.
- Erro passageiro (banco ou Kafka fora do ar) não vai para a DLQ: o billing repete a mensagem, com espera de 1 s dobrando até 30 s, e só avança o offset depois de processar.
- Fatura `PAID`, `PAYMENT_FAILED` ou `CANCELLED` não muda com um cancelamento (não há estorno).
