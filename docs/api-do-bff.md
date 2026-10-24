# API do bff-gateway

O `bff-gateway` é a porta de entrada da API do omni-market: autentica o JWT do Keycloak, autoriza cada rota por papel ([matriz de permissões](matriz-de-permissoes.md)) e consulta os serviços internos. Como não há frontend, a demo usa estas rotas direto, pela coleção [`api-do-bff.http`](api-do-bff.http) (VS Code REST Client) ou pelo `curl`.

Base: `http://localhost:8080` (a variável `BFF_PORT` muda a porta). Toda rota exige o header `Authorization: Bearer <token>`.

**Swagger:** a interface fica em http://localhost:8080/swagger-ui/index.html e o contrato OpenAPI em http://localhost:8080/v3/api-docs, ambos sem token. Para chamar as rotas pela interface, gere um token (abaixo), clique em **Authorize** e cole o `access_token` sem o prefixo `Bearer`.

## Token por persona

A senha de cada usuário é igual ao nome de usuário: `admin`, `loja`, `especialista`, `fiscal`, `csm` e `customer`. O `client_secret` é o do [README](../README.md#keycloak).

```bash
CLIENT_SECRET=<client_secret do README>
token() {
  curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
    -d grant_type=password -d client_id=bff-gateway -d client_secret="$CLIENT_SECRET" \
    -d username="$1" -d password="$1" | jq -r .access_token
}
CSM=$(token csm)
curl -s -H "Authorization: Bearer $CSM" "http://localhost:8080/orders?limit=2"
```

O token vale 5 minutos (`accessTokenLifespan` do realm).

## Convenções

- **Paginação:** `limit` (de 1 a 100, padrão 20) e `offset` (a partir de 0, padrão 0). A resposta repete `limit` e `offset`.
- **Filtros:** `marketplace` aceita `AMAZON`, `MERCADO_LIVRE` e `SHOPEE`, em maiúsculas. Cada rota lista os valores de `status`.
- **Formatos:** ids são UUID, datas de relatório são `YYYY-MM-DD`, instantes são ISO-8601 em UTC e valores em dinheiro são `number`, em reais. A ordem dos campos no JSON não é garantida.
- **Usuário nos serviços:** o BFF repassa o `sub` do token ao serviço de destino no header `X-User-Id` ([ADR-0009](adr/0009-chamada-entre-servicos-sem-token-na-rede-interna.md)).
- **Erros:** `application/problem+json` (`ProblemDetail`), com `status`, `title` e `detail`.

| Status | Quando |
|---|---|
| 400 | Parâmetro inválido (valor fora do enum, `limit` fora de 1 a 100, `offset` negativo, data malformada, `from` depois de `to`, id que não é UUID) ou pedido rejeitado pelo serviço de destino (400 ou 422), cujo `detail` é repassado |
| 401 | Sem token, ou token inválido ou expirado |
| 403 | O papel do token não pode usar a rota ([matriz](matriz-de-permissoes.md)) |
| 404 | O recurso não existe |
| 502 | O serviço de destino respondeu com erro (5xx), com um corpo ilegível ou com um status que o BFF não espera. O problema traz a propriedade `service` |
| 503 | O serviço de destino não respondeu (fora do ar, conexão recusada ou tempo esgotado: 2 s para conectar e 10 s para responder) ou respondeu 502, 503 ou 504. O problema traz a propriedade `service` |

```json
{ "title": "Service Unavailable", "status": 503, "detail": "order-service is unavailable", "instance": "/orders", "service": "order-service" }
```

## Pedidos

### `GET /orders`

Papéis: `admin`, `store` e `csm`. Lista os pedidos. O mock devolve do mais recente para o mais antigo.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `marketplace` | enum | Opcional. Marketplace de origem |
| `status` | enum | Opcional. `RECEIVED`, `CONFIRMED`, `PAID` ou `CANCELLED` |
| `limit`, `offset` | inteiro | Opcionais. Paginação |

```bash
curl -s -H "Authorization: Bearer $CSM" "http://localhost:8080/orders?marketplace=AMAZON&status=PAID"
```

```json
{
  "orders": [
    {
      "id": "6f1c2b8e-0000-4000-8000-000000000004",
      "marketplace": "AMAZON",
      "externalOrderId": "AMZ-1000002",
      "status": "PAID",
      "total": 18689.90,
      "items": [
        { "sku": "OXI-001", "quantity": 1, "unitPrice": 189.90 },
        { "sku": "MON-002", "quantity": 1, "unitPrice": 18500.00 }
      ],
      "cancellationReason": null,
      "createdAt": "2026-10-27T11:00:00Z",
      "updatedAt": "2026-10-27T11:00:06Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

`cancellationReason` só vem preenchido em pedido `CANCELLED` (`OUT_OF_STOCK`, `PAYMENT_FAILED` ou `MARKETPLACE_CANCELLED`).

### `GET /orders/{id}`

Papéis: `admin`, `store` e `csm`. Devolve um pedido, no mesmo formato de cada item de `orders`. Responde 404 se o pedido não existe.

### `GET /reports/sales-by-marketplace`

Papéis: `admin` e `csm`. Vendas por marketplace no período de `from` a `to`.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `from` | data | Obrigatório. `YYYY-MM-DD` |
| `to` | data | Obrigatório. `YYYY-MM-DD`, não pode ser anterior a `from` |

```bash
curl -s -H "Authorization: Bearer $CSM" "http://localhost:8080/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31"
```

```json
{
  "from": "2026-10-01",
  "to": "2026-10-31",
  "marketplaces": [
    { "marketplace": "AMAZON", "orders": 1, "units": 2, "totalAmount": 18689.90 },
    { "marketplace": "MERCADO_LIVRE", "orders": 1, "units": 1, "totalAmount": 18500.00 },
    { "marketplace": "SHOPEE", "orders": 2, "units": 3, "totalAmount": 18879.80 }
  ]
}
```

## Cobranças

### `GET /invoices`

Papéis: `admin`, `store` e `fiscal` (somente leitura). Lista as faturas, com o status do pagamento.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `orderId` | UUID | Opcional. A fatura de um pedido (há uma por pedido) |
| `marketplace` | enum | Opcional. Marketplace do pedido |
| `status` | enum | Opcional. `ISSUED`, `PAYMENT_PENDING`, `PAID`, `PAYMENT_FAILED` ou `CANCELLED` |
| `limit`, `offset` | inteiro | Opcionais. Paginação |

O contrato não tem filtro por loja, porque a demo tem uma loja só: o recorte por canal é o `marketplace`.

```bash
FISCAL=$(token fiscal)
curl -s -H "Authorization: Bearer $FISCAL" "http://localhost:8080/invoices?status=PAYMENT_FAILED"
```

```json
{
  "invoices": [
    {
      "id": "1d7e3a10-0000-4000-8000-000000000002",
      "orderId": "6f1c2b8e-0000-4000-8000-000000000002",
      "externalOrderId": "AMZ-1000001",
      "marketplace": "AMAZON",
      "status": "PAYMENT_FAILED",
      "amount": 111000.00,
      "commissionPercent": 12.00,
      "commissionAmount": 13320.00,
      "netAmount": 97680.00,
      "items": [{ "sku": "MON-002", "quantity": 6, "unitPrice": 18500.00, "amount": 111000.00 }],
      "issuedAt": "2026-10-28T13:10:03Z",
      "cancelledAt": null,
      "cancellationReason": null,
      "pspTransactionId": "ch_failed_1d7e3a10-0000-4000-8000-000000000002",
      "failureReason": "INSUFFICIENT_FUNDS",
      "paidAt": null,
      "failedAt": "2026-10-28T13:10:06Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

- `amount` é o total do pedido. A comissão do Omni Market é `amount` vezes a taxa do marketplace (`commissionPercent`: Amazon 12, Mercado Livre 11 e Shopee 14), arredondada no centavo, e `netAmount` é o que cabe à loja (`amount` menos `commissionAmount`).
- Os campos do desfecho só vêm preenchidos no status correspondente, e nos outros vêm `null`: `PAID` (`paidAt` e `pspTransactionId`), `PAYMENT_FAILED` (`failedAt`, `failureReason` e `pspTransactionId`) e `CANCELLED` (`cancelledAt` e `cancellationReason`). `PAYMENT_PENDING` já tem `pspTransactionId`, e `ISSUED` ainda não tem nenhum.

### `GET /invoices/{id}`

Papéis: `admin`, `store` e `fiscal`. Devolve uma fatura, no mesmo formato de cada item de `invoices`. Responde 404 se a fatura não existe.

## Anúncios nos marketplaces

### `GET /listings`

Papéis: `admin` e `store`. Lista os anúncios de cada produto em cada marketplace, com o status da publicação. Um produto aprovado tem um anúncio por marketplace.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `sku` | texto | Opcional. Os anúncios de um produto (ex.: `OXI-001`). Em branco, vale como sem filtro |
| `marketplace` | enum | Opcional. Marketplace do anúncio |
| `status` | enum | Opcional. `PUBLISHED`, `FAILED` ou `PENDING` |
| `limit`, `offset` | inteiro | Opcionais. Paginação |

```bash
STORE=$(token loja)
curl -s -H "Authorization: Bearer $STORE" "http://localhost:8080/listings?sku=OXI-001"
```

```json
{
  "listings": [
    {
      "id": "7a2b9c10-0000-4000-8000-000000000003",
      "sku": "OXI-001",
      "marketplace": "SHOPEE",
      "externalListingId": null,
      "status": "FAILED",
      "price": 189.90,
      "stock": 2,
      "failureReason": "HTTP 503 after retries",
      "updatedAt": "2026-10-27T10:00:21Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

(O exemplo mostra só o anúncio com falha, dos três do `OXI-001`.)

- `PUBLISHED` tem o `externalListingId` que o marketplace devolveu. `FAILED` traz o motivo da última tentativa em `failureReason`, e `PENDING` ainda aguarda a publicação. Os campos que não se aplicam vêm `null`.
- `price` e `stock` são os valores anunciados.

### `GET /listings/{id}`

Papéis: `admin` e `store`. Devolve um anúncio, no mesmo formato de cada item de `listings`. Responde 404 se o anúncio não existe.

## Catálogo

### `PATCH /catalog/products/{sku}/price`

Papéis: `admin` e `store`, ou o escopo `catalog:write`. Altera o preço de um produto que já existe no catálogo e responde `204` sem corpo. O catalog-service grava o novo preço e publica `catalog.product.price-changed.v1` para os marketplaces ([eventos](eventos.md#catalogproductprice-changedv1)).

```json
{ "price": 4999.90 }
```

- `price` é o valor absoluto em reais, maior ou igual a 0. Sem `price`, com valor negativo ou com JSON malformado, responde 400.
- Responde 404 se o catálogo não conhece o SKU.
- Repetir o preço vigente responde `204` e não publica evento.

## Mock e serviço real

Cada domínio com serviço de destino tem dois gateways, e a propriedade `app.gateways.<domínio>` escolhe um: `rest` chama o serviço (é o padrão, inclusive no compose) e `mock` responde com dados de demonstração dentro do BFF. A variável de ambiente é `APP_GATEWAYS_<DOMÍNIO>`.

| Domínio | URL do serviço (variável) | Padrão |
|---|---|---|
| `order` | `ORDER_SERVICE_URL` | `http://order-service:8084` |
| `billing` | `BILLING_SERVICE_URL` | `http://billing-service:8086` |
| `marketplace` | `MARKETPLACE_GATEWAY_URL` | `http://marketplace-gateway:8087` |

- Rodando o BFF fora do Docker (`make compose-up-infra`), os nomes dos serviços não resolvem: use `ORDER_SERVICE_URL=http://localhost:8084`, `BILLING_SERVICE_URL=http://localhost:8086` e `MARKETPLACE_GATEWAY_URL=http://localhost:8087`.
- Para ensaiar sem os serviços: `APP_GATEWAYS_ORDER=mock APP_GATEWAYS_BILLING=mock APP_GATEWAYS_MARKETPLACE=mock ./mvnw spring-boot:run`.
- **Dados do mock de pedidos:** 8 pedidos, de 26 a 28/10/2026, com os produtos da demo (`OXI-001` e `MON-002`) e todos os status. O relatório conta só os pedidos `CONFIRMED` e `PAID`.
- **Dados do mock de cobranças:** 6 faturas, uma para cada status (duas são `PAID`), ligadas aos pedidos do mock pelo mesmo `orderId`, marketplace, itens e total. A comissão segue as taxas acima.
- **Dados do mock de anúncios:** 6 anúncios, os dois produtos da demo (`OXI-001` e `MON-002`) nos três marketplaces. Quatro estão `PUBLISHED`, um `FAILED` (`OXI-001` na Shopee, com `HTTP 503 after retries`) e um `PENDING` (`MON-002` no Mercado Livre). O preço é o mesmo dos pedidos do mock.
- No modo `rest`, com o serviço fora do ar, a rota responde 503.

## O que o BFF espera dos serviços

Os contratos abaixo são propostos: os donos dos serviços ainda os implementam, e qualquer mudança fica isolada em `infra/<domínio>/gateway` do BFF. Os erros dos serviços vêm em `application/problem+json`. O BFF tolera campos novos nas respostas e trata como erro de gateway (502) um valor de enum que ele não conhece.

### order-service (#20 e #31)

| Chamada | Resposta |
|---|---|
| `GET /orders?marketplace=&status=&limit=20&offset=0` | `{ "orders": [Order], "limit": 20, "offset": 0 }` |
| `GET /orders/{id}` | `Order`, ou 404 |
| `GET /reports/sales-by-marketplace?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ "from": "…", "to": "…", "marketplaces": [{ "marketplace": "AMAZON", "orders": 3, "units": 5, "totalAmount": 75000.00 }] }` |

`Order` é `{ id (uuid), marketplace, externalOrderId, status (RECEIVED, CONFIRMED, PAID ou CANCELLED), total, items: [{ sku, quantity, unitPrice }], cancellationReason (string ou null), createdAt, updatedAt }`. O `marketplace` é `AMAZON`, `MERCADO_LIVRE` ou `SHOPEE`, como em `docs/eventos.md`.

Um 400 ou 422 do serviço vira 400 no BFF, com o `detail` do problema. Um 404 só é esperado em `GET /orders/{id}`.

### billing-service (#23)

| Chamada | Resposta |
|---|---|
| `GET /invoices?orderId=&status=&marketplace=&limit=20&offset=0` | `{ "invoices": [Invoice], "limit": 20, "offset": 0 }` |
| `GET /invoices/{id}` | `Invoice`, ou 404 |

`Invoice` é `{ id (uuid), orderId (uuid), externalOrderId, marketplace, status (ISSUED, PAYMENT_PENDING, PAID, PAYMENT_FAILED ou CANCELLED), amount, commissionPercent, commissionAmount, netAmount, items: [{ sku, quantity, unitPrice, amount }], issuedAt, cancelledAt, cancellationReason, pspTransactionId, failureReason, paidAt, failedAt }`. Os campos do desfecho (`cancelledAt`, `cancellationReason`, `pspTransactionId`, `failureReason`, `paidAt` e `failedAt`) são `null` quando não se aplicam. Os campos seguem `billing.invoice.issued.v1` e `billing.payment.*` de `docs/eventos.md`. O erro de um 400 ou 422 e o 404 seguem a mesma regra do order-service.

### catalog-service (#77)

| Chamada | Resposta |
|---|---|
| `POST /products/import` com `{ items: [{ sku, name, description, price, stock }] }` | 2xx sem corpo |
| `PATCH /products/sku/{sku}/price` com `{ "price": 4999.90 }` | `204`, ou 404 se o SKU não existe |

O catálogo não tem gateway mock: as rotas de catálogo sempre chamam o serviço (`CATALOG_SERVICE_URL`, padrão `http://localhost:8082`). O erro de um 400 ou 422 segue a mesma regra do order-service.

### marketplace-gateway (#21)

| Chamada | Resposta |
|---|---|
| `GET /listings?sku=&marketplace=&status=&limit=20&offset=0` | `{ "listings": [Listing], "limit": 20, "offset": 0 }` |
| `GET /listings/{id}` | `Listing`, ou 404 |

`Listing` é `{ id (uuid), sku, marketplace, externalListingId (string ou null), status (PUBLISHED, FAILED ou PENDING), price, stock (inteiro), failureReason (string ou null), updatedAt }`. O erro de um 400 ou 422 e o 404 seguem a mesma regra do order-service.
