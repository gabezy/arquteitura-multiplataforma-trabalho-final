# API do bff-gateway

O `bff-gateway` é a porta de entrada da API do omni-market: autentica o JWT do Keycloak, autoriza cada rota por papel ([matriz de permissões](matriz-de-permissoes.md)) e consulta os serviços internos. Como não há frontend, a demo usa estas rotas direto, pela coleção [`api-do-bff.http`](api-do-bff.http) (VS Code REST Client) ou pelo `curl`.

Base: `http://localhost:8080` (a variável `BFF_PORT` muda a porta). Toda rota exige o header `Authorization: Bearer <token>`.

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

## Mock e serviço real

Cada domínio com serviço de destino tem dois gateways, e a propriedade `app.gateways.<domínio>` escolhe um: `rest` chama o serviço (é o padrão, inclusive no compose) e `mock` responde com dados de demonstração dentro do BFF. A variável de ambiente é `APP_GATEWAYS_<DOMÍNIO>`.

| Domínio | URL do serviço (variável) | Padrão |
|---|---|---|
| `order` | `ORDER_SERVICE_URL` | `http://order-service:8084` |

- Rodando o BFF fora do Docker (`make up-infra`), o padrão `order-service` não resolve: use `ORDER_SERVICE_URL=http://localhost:8084`.
- Para ensaiar sem o serviço: `APP_GATEWAYS_ORDER=mock ./mvnw spring-boot:run`. Os dados do mock são 8 pedidos, de 26 a 28/10/2026, com os produtos da demo (`OXI-001` e `MON-002`) e todos os status. O relatório conta só os pedidos `CONFIRMED` e `PAID`.
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
