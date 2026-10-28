# Simuladores dos marketplaces (WireMock)

O trabalho não integra com os marketplaces reais. O `marketplace-gateway` conversa com três simuladores no WireMock, um para Amazon, um para Mercado Livre e um para Shopee. As três APIs são **diferentes entre si** de propósito: é essa diferença que a anti-corruption layer do gateway traduz ([ADR-0008](adr/0008-anticorruption-layer-um-adapter-por-marketplace.md)). Os contratos são simplificados e **inspirados** nas APIs reais; não são cópias delas.

- Os simuladores não guardam estado. A resposta vem da requisição (eco do SKU, id gerado) e dos cenários de falha.
- Pedidos simulados são a exceção controlada: um script registra o pedido num stub dinâmico do WireMock (ver [Pedidos simulados](#pedidos-simulados)).

## Como subir e conferir

`make compose-up-infra` (ou `make compose-up`) sobe o WireMock na porta 8089 (`http://localhost:8089` na máquina, `http://wiremock:8080` na rede do compose). Os mappings são carregados de `docker/wiremock/mappings/` e as respostas com template ficam em `docker/wiremock/__files/<marketplace>/`.

```bash
WM=http://localhost:8089
curl -s $WM/__admin/mappings | jq '.meta.total'      # mappings carregados
curl -s $WM/__admin/scenarios | jq -c '[.scenarios[] | {name, state}]'   # amazon-mode, mercadolivre-mode e shopee-mode, todos em Started
```

| Arquivo | O que tem |
|---|---|
| `docker/wiremock/mappings/amazon.json` | simulador da Amazon, sob `/amazon` |
| `docker/wiremock/mappings/mercadolivre.json` | simulador do Mercado Livre, sob `/mercadolivre` |
| `docker/wiremock/mappings/shopee.json` | simulador da Shopee, sob `/shopee` |
| `docker/wiremock/__files/<marketplace>/*.json` | corpos das respostas, com response templating |

O mapping `psp.json` (PSP do billing) e o `catalog.json` não fazem parte dos simuladores.

## Visão geral

| Operação | Amazon (`/amazon`) | Mercado Livre (`/mercadolivre`) | Shopee (`/shopee`) |
|---|---|---|---|
| Publicar anúncio | `PUT /listings/2021-08-01/items/{sellerId}/{sku}` | `POST /items` | `POST /api/v2/product/add_item` |
| Atualizar estoque e preço | `PATCH` no mesmo caminho, com JSON Patch | `PUT /items/{id}` | `POST /api/v2/product/update_stock` e `POST /api/v2/product/update_price` |
| Consultar anúncio | `GET` no mesmo caminho | `GET /items/{id}` | `GET /api/v2/product/get_item_base_info?item_id_list={id}` |
| Listar pedidos novos | `GET /orders/v0/orders` | `GET /orders/search` | `GET /api/v2/order/get_order_list` |
| Cancelar pedido | `POST /orders/v0/orders/{id}/cancellation` | `PUT /orders/{id}` com `{"status":"cancelled"}` | `POST /api/v2/order/cancel_order` |

O que cada adapter do gateway precisa traduzir:

| | Amazon | Mercado Livre | Shopee |
|---|---|---|---|
| Identidade do anúncio | o SKU está no caminho; o id do anúncio é o `asin` da resposta | `id` (`MLB` e 10 dígitos) | `item_id` numérico dentro de `response` |
| Estilo | recurso por SKU, `PUT` idempotente e `PATCH` | `POST` e `PUT` de itens | chamadas estilo RPC, sempre `POST` |
| Erro | HTTP 4xx com `errors[]` | HTTP 4xx com `cause[]` | **HTTP 200** com `error` preenchido |
| Preço no pedido | `ItemPrice` é o valor da **linha**, como texto | `unit_price` é o valor **unitário** | `model_discounted_price` é o **unitário** |
| Data do pedido | ISO-8601 em UTC (`Z`) | ISO-8601 com `-03:00` | epoch em segundos |
| Id do pedido | texto (`701-0000001-0000001`) | **número** | texto (`SHP261028A1B2C3`) |
| Lista de pedidos | `payload.Orders` | `results`, paginado por `offset` e `limit` | `response.order_list`, com `more` e cursor |

## Exemplos de chamada

Os exemplos usam `WM=http://localhost:8089`. O `Idempotency-Key` é o id do anúncio no gateway; os simuladores o aceitam e não o validam.

### Amazon

```bash
# publicar (depois de items/ vêm o id do vendedor e o SKU)
curl -s -X PUT "$WM/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  -d '{"productType":"PRODUCT","attributes":{"item_name":[{"value":"Notebook"}],"list_price":[{"currency":"BRL","value":4500}],"fulfillment_availability":[{"fulfillment_channel_code":"DEFAULT","quantity":2}]}}'
# 200 {"sku":"NB-001","status":"ACCEPTED","submissionId":"<uuid>","asin":"B0<8 caracteres>","issues":[]}

# atualizar o estoque (e/ou o preço, em /attributes/list_price)
curl -s -X PATCH "$WM/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001" \
  -H 'Content-Type: application/json' \
  -d '{"productType":"PRODUCT","patches":[{"op":"replace","path":"/attributes/fulfillment_availability","value":[{"fulfillment_channel_code":"DEFAULT","quantity":1}]}]}'
# 200 {"sku":"NB-001","status":"ACCEPTED","submissionId":"<uuid>","issues":[]}

# consultar
curl -s "$WM/amazon/listings/2021-08-01/items/A1B2C3D4E5/NB-001"
# 200 {"sku":"NB-001","summaries":[{"asin":"B0SIMULATED","itemName":"Anúncio simulado","status":["BUYABLE"]}],"issues":[]}

# pedidos novos
curl -s "$WM/amazon/orders/v0/orders?CreatedAfter=2026-10-28T00:00:00Z&OrderStatuses=Unshipped"
# 200 {"payload":{"Orders":[],"NextToken":null}}

# cancelar
curl -s -X POST "$WM/amazon/orders/v0/orders/701-1111111-2222222/cancellation" \
  -H 'Content-Type: application/json' -d '{"cancelReason":"OUT_OF_STOCK"}'
# 200 {"payload":{"AmazonOrderId":"701-1111111-2222222","OrderStatus":"Canceled"}}
```

### Mercado Livre

```bash
# publicar
curl -s -X POST "$WM/mercadolivre/items" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  -d '{"title":"Notebook","category_id":"MLB1648","price":4500.5,"currency_id":"BRL","available_quantity":2,"buying_mode":"buy_it_now","listing_type_id":"gold_special","condition":"new","seller_custom_field":"NB-001"}'
# 201 {"id":"MLB<10 dígitos>","title":"Anúncio simulado","seller_custom_field":"NB-001","status":"active","currency_id":"BRL","price":4500.5,"available_quantity":2,"permalink":"..."}

# atualizar estoque e/ou preço
curl -s -X PUT "$WM/mercadolivre/items/MLB1234567890" \
  -H 'Content-Type: application/json' -d '{"available_quantity":1}'
# 200 {"id":"MLB1234567890","status":"active","last_updated":"<data>"}

# consultar
curl -s "$WM/mercadolivre/items/MLB1234567890"

# pedidos novos
curl -s "$WM/mercadolivre/orders/search?seller=2000&order.status=paid&order.date_created.from=2026-10-28T00:00:00.000-03:00&offset=0&limit=50"
# 200 {"results":[],"paging":{"total":0,"offset":0,"limit":50}}

# cancelar
curl -s -X PUT "$WM/mercadolivre/orders/2000001" \
  -H 'Content-Type: application/json' -d '{"status":"cancelled","reason":"OUT_OF_STOCK"}'
# 200 {"id":"2000001","status":"cancelled"}
```

### Shopee

```bash
# publicar
curl -s -X POST "$WM/shopee/api/v2/product/add_item?shop_id=1001" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  -d '{"item_name":"Notebook","description":"Notebook 16GB","original_price":4500.5,"normal_stock":2,"item_sku":"NB-001","category_id":100001}'
# 200 {"error":"","message":"","request_id":"<uuid>","response":{"item_id":412525791}}

# atualizar estoque e preço (duas chamadas)
curl -s -X POST "$WM/shopee/api/v2/product/update_stock?shop_id=1001" \
  -H 'Content-Type: application/json' -d '{"item_id":412525791,"stock_list":[{"model_id":0,"normal_stock":1}]}'
curl -s -X POST "$WM/shopee/api/v2/product/update_price?shop_id=1001" \
  -H 'Content-Type: application/json' -d '{"item_id":412525791,"price_list":[{"model_id":0,"original_price":4300.9}]}'
# 200 {"error":"","message":"","request_id":"<uuid>","response":{"success_list":[{"model_id":0,"normal_stock":1}],"failure_list":[]}}

# consultar (um item_id por chamada)
curl -s "$WM/shopee/api/v2/product/get_item_base_info?shop_id=1001&item_id_list=412525791"

# pedidos novos
curl -s "$WM/shopee/api/v2/order/get_order_list?shop_id=1001&time_range_field=create_time&time_from=1793100000&time_to=1793200000&page_size=100&order_status=READY_TO_SHIP"
# 200 {"error":"","message":"","request_id":"simulated","response":{"more":false,"next_cursor":"","order_list":[]}}

# cancelar
curl -s -X POST "$WM/shopee/api/v2/order/cancel_order?shop_id=1001" \
  -H 'Content-Type: application/json' -d '{"order_sn":"SHP261028A1B2C3","cancel_reason":"OUT_OF_STOCK"}'
# 200 {"error":"","message":"","request_id":"<uuid>","response":{"update_time":<epoch em segundos>}}
```

## Recusas determinísticas

Dão a falha **definitiva** (sem retry) do gateway sem precisar ligar cenário nenhum.

| Quando | Amazon | Mercado Livre | Shopee |
|---|---|---|---|
| Anúncio com preço menor ou igual a zero (`list_price.value`, `price`, `original_price`) | `400` com `errors[0].code = InvalidInput` | `400` com `cause[0].code = item.price.invalid` | `200` com `error = error_param` |
| Cancelar pedido cujo id contém `SHIPPED` | `409` | `409` | `200` com `error = error_cannot_cancel` |
| Cancelar pedido cujo id contém `UNKNOWN` | `404` | `404` | `200` com `error = error_not_found` |

Na demo, um produto com preço `0` no catálogo faz o anúncio falhar nos 3 marketplaces, cada um no seu formato de erro.

## Cenários de falha

Cada simulador tem um cenário do WireMock (`amazon-mode`, `mercadolivre-mode` e `shopee-mode`) que, fora do estado normal, faz **toda** chamada ao marketplace falhar, inclusive a consulta de pedidos.

| Modo | Efeito | Para que serve |
|---|---|---|
| `unavailable` | toda chamada responde `503` | retry, circuit breaker e anúncio `FAILED` |
| `throttled` | toda chamada responde `429` com `Retry-After: 1` | espera pelo `Retry-After` |
| `slow` | toda chamada demora 8 s e responde `504`; o gateway desiste antes, pelo timeout de 3 s | timeout |
| `flaky` | as 2 próximas chamadas respondem `503` e as seguintes voltam ao normal | retry que dá certo na 3ª tentativa |
| `off` | volta ao normal | |

```bash
scripts/simulate-failure.sh shopee unavailable    # só a Shopee cai: Amazon e Mercado Livre seguem
scripts/simulate-failure.sh all throttled         # os três respondem 429
scripts/simulate-failure.sh amazon flaky
scripts/simulate-failure.sh all off               # desliga todos
```

O script chama a API admin do WireMock: `PUT /__admin/scenarios/{marketplace}-mode/state` com `{"state":"UNAVAILABLE"}` (os estados são `UNAVAILABLE`, `THROTTLED`, `SLOW`, `FLAKY_1`, `FLAKY_2` e `Started`, o normal). `curl -X POST $WM/__admin/scenarios/reset` volta os três ao normal.

## Pedidos simulados

O gateway busca os pedidos por polling ([ADR-0010](adr/0010-pedidos-dos-marketplaces-por-polling.md)). Para ter um pedido na próxima consulta, o script registra um stub dinâmico do WireMock com o pedido, no formato do marketplace:

```bash
scripts/simulate-order.sh all                                   # um pedido de cada marketplace: 1 x NB-001 a R$ 4.500,00
scripts/simulate-order.sh mercadolivre --sku IPHONE-15 --qty 7 --price 15000
scripts/simulate-order.sh amazon --id 701-1111111-2222222       # repetir o id não cria outro pedido no Kafka
scripts/simulate-order.sh all --clear                           # remove os pedidos simulados
```

| Opção | Padrão |
|---|---|
| `--sku` | `NB-001` |
| `--qty` | `1` |
| `--price` | `4500.00` (preço unitário em reais) |
| `--id` | gerado (Amazon `701-` e 14 dígitos, Mercado Livre número de 10 dígitos, Shopee `SHP` e data e 6 hex) |

O script precisa de `curl` e `jq`, e usa `WIREMOCK_URL` (padrão `http://localhost:8089`).

Como funciona: cada marketplace tem um stub de pedidos novos que devolve a lista vazia. O script cria um segundo stub, com prioridade maior e `persistent: false`, que devolve a lista de pedidos simulados, e a cada execução acrescenta um pedido a essa lista. Os stubs dinâmicos ficam só na memória do WireMock: nenhum arquivo muda. O WireMock não filtra por data nem por status, então devolve todos os pedidos a cada consulta, e quem evita a duplicata é o gateway (índice único por marketplace e id do pedido). Um pedido que o gateway já viu continua na lista e não gera evento de novo.

Formato de cada pedido (o que o script registra):

```jsonc
// Amazon (OrderTotal e ItemPrice são o valor da linha, em texto)
{ "AmazonOrderId": "701-1111111-2222222", "PurchaseDate": "2026-10-28T13:05:00Z", "OrderStatus": "Unshipped",
  "OrderTotal": { "CurrencyCode": "BRL", "Amount": "4500.00" },
  "OrderItems": [{ "SellerSKU": "NB-001", "QuantityOrdered": 1, "ItemPrice": { "CurrencyCode": "BRL", "Amount": "4500.00" } }] }

// Mercado Livre (unit_price é o valor unitário)
{ "id": 2000001, "status": "paid", "date_created": "2026-10-28T10:05:00.000-03:00", "total_amount": 4500, "currency_id": "BRL",
  "order_items": [{ "item": { "id": "MLB1000000001", "seller_custom_field": "NB-001" }, "quantity": 1, "unit_price": 4500 }] }

// Shopee (create_time em epoch; model_discounted_price é o valor unitário)
{ "order_sn": "SHP261028A1B2C3", "order_status": "READY_TO_SHIP", "create_time": 1793192700, "total_amount": 4500,
  "item_list": [{ "item_sku": "NB-001", "model_quantity_purchased": 1, "model_discounted_price": 4500 }] }
```

## Voltar ao estado de arquivo

```bash
curl -s -X POST $WM/__admin/mappings/reset      # remove os stubs dinâmicos e recarrega os mappings dos arquivos
curl -s -X POST $WM/__admin/scenarios/reset     # volta os cenários de falha ao normal
curl -s -X POST $WM/__admin/reset               # os dois acima e o histórico de requisições
```

Reiniciar o container do WireMock faz o mesmo.

## Onde o gateway usa

- Os adapters do gateway ficam em `marketplace-gateway/src/infra/marketplace/` (um por marketplace, atrás da `MarketplacePort`) e entram com as issues #21, #22 e #33.
- Os testes dos adapters rodam contra um WireMock de Testcontainers com **estes mesmos** mappings, então uma mudança aqui que quebre o contrato quebra o CI do gateway.
- A política de resiliência (timeout de 3 s, 3 tentativas, circuit breaker) está no [ADR-0009](adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md).
