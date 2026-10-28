# Demo: estoque reservado a partir do pedido

O catalog-service é dono do estoque (#30). Ele baixa o estoque quando recebe `order.order.placed.v1`, devolve quando recebe `order.order.cancelled.v1` e responde com eventos via outbox:

| Evento publicado | Chave | Quando |
|---|---|---|
| `catalog.stock.reserved.v1` | `orderId` | todos os itens do pedido foram baixados |
| `catalog.stock.insufficient.v1` | `orderId` | algum item não tem estoque (nada é baixado) |
| `catalog.product.stock-changed.v1` | `productId` | o estoque de um produto mudou (valor absoluto) |

Aqui os eventos de pedido são publicados à mão, para isolar o catalog. O ciclo completo, com o order-service publicando os pedidos, está em [`demo-pedidos.md`](demo-pedidos.md).

## Preparação

Na raiz do repositório:

```bash
docker compose up -d && docker compose up -d kafka-init
```

Em `catalog-service/`:

```bash
npm run migrate && npm run dev
```

Crie um produto com 2 unidades e aprove a análise (sem o compliance-service rodando, publique o resultado à mão):

```bash
curl -s -X POST localhost:8082/products -H 'content-type: application/json' \
  -d '{"sku":"NB-001","name":"Notebook","description":"Notebook 16GB RAM","price":4500,"stock":2}'

echo '{"sku":"NB-001","status":"APPROVED"}' | docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka:19092 --topic produto.analisado.v1
```

Para publicar um evento de pedido (`chave|valor`):

```bash
order() { # order <tópico> <orderId> <json>
  echo "$2|$3" | docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 \
    --topic "$1" --reader-property parse.key=true --reader-property key.separator='|'
}
stock() { curl -s localhost:8082/products/sku/NB-001 | grep -o '"stock":[0-9]*'; }
```

Também dá para publicar pelo Kafka UI (http://localhost:8090), em *Topics → order.order.placed.v1 → Produce Message*.

## Roteiro

1. **Venda normal**: 2 → 1, publica `reserved` e `stock-changed` (`stock: 1`).

   ```bash
   order order.order.placed.v1 6f1c2b8e-0000-4000-8000-000000000001 \
     '{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","items":[{"sku":"NB-001","quantity":1}]}'
   stock
   ```

2. **Falta estoque**: pede 2 com 1 em estoque, nada muda, publica `insufficient`.

   ```bash
   order order.order.placed.v1 6f1c2b8e-0000-4000-8000-000000000002 \
     '{"orderId":"6f1c2b8e-0000-4000-8000-000000000002","items":[{"sku":"NB-001","quantity":2}]}'
   ```

3. **Esgotou**: 1 → 0, `stock-changed` com `stock: 0` (o marketplace-gateway zera o anúncio).

   ```bash
   order order.order.placed.v1 6f1c2b8e-0000-4000-8000-000000000003 \
     '{"orderId":"6f1c2b8e-0000-4000-8000-000000000003","items":[{"sku":"NB-001","quantity":1}]}'
   ```

4. **Cancelamento**: devolve o estoque do pedido 1 (0 → 1), publica `stock-changed`.

   ```bash
   order order.order.cancelled.v1 6f1c2b8e-0000-4000-8000-000000000001 \
     '{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","reason":"PAYMENT_FAILED"}'
   ```

Para ver as respostas:

```bash
docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:19092 --from-beginning \
  --include 'catalog\.(stock\..*|product\.stock-changed)\.v1' --formatter-property print.key=true --timeout-ms 5000
```

## Regras

- Pedido com vários itens é tudo ou nada.
- Repetir um evento não muda nada: há uma reserva por `orderId`.
- Cancelamento que chega antes do pedido fica registrado, e o pedido que chega depois não baixa estoque.
- SKU desconhecido, não aprovado ou malformado conta como `available: 0`.
- Mensagem fora do contrato (JSON inválido, `orderId` que não é UUID, `items` vazio, `quantity` ≤ 0) vai para `catalog.order-stock.dlq`.
