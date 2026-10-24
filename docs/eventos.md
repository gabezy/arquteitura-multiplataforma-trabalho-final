# Catálogo de eventos e contratos

Contratos de mensageria (Kafka) e das chamadas REST entre os serviços do omni-market. Este é o lugar onde um evento novo é combinado **antes** de ser implementado: primeiro entra aqui, depois no `docker/kafka/create-topics.sh` e no código.

Cada contrato tem um estado:

| Estado | Significado |
|---|---|
| **Implementado** | Existe no código da `dev`. A ficha foi tirada do código (schemas zod/pydantic e mappers) |
| **Provisório** | Um lado já existe e o outro ainda não. O contrato vale como está, e mudanças são combinadas com o dono do lado pronto |
| **Proposto** | Ainda não existe. Precisa ser aprovado pelo dono indicado antes de virar código |

## Convenções

- **Formato:** [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/kafka-protocol-binding.md) em *binary mode*. Os atributos vão nos headers `ce_*`, e o valor da mensagem é só o `data`, em JSON.
  - Headers obrigatórios: `ce_specversion=1.0`, `ce_id`, `ce_source`, `ce_type`, `ce_subject` (id do agregado), `ce_time` (ISO-8601) e `content-type=application/json`.
  - `ce_source=/<serviço>` (ex.: `/catalog-service`).
  - `ce_type` é igual ao nome do tópico.
  - `traceparent` (W3C) segue nos headers, para o trace atravessar os serviços.
- **Nome do tópico:** `<serviço>.<agregado>.<evento>.vN`, um tópico por tipo de evento. A única exceção é `produto.analisado.v1` (ver [Divergências](#divergências-conhecidas)).
- **Chave da mensagem:** o id do agregado que gerou o evento. A ordem é garantida por agregado dentro de um mesmo tópico, nunca entre tópicos diferentes.
- **Publicação:** sempre por transactional outbox ([ADR-0002](adr/0002-outbox-para-eventos-do-catalog-service.md)). O evento existe se e somente se a transação do agregado commitou.
- **Entrega:** *at-least-once*. Todo consumidor é idempotente: deduplica por `ce_id` (inbox, como a tabela `processed_events`) ou pelo estado do agregado.
- **Falhas:** uma DLQ por consumer group, chamada `<serviço consumidor>.<assunto>.dlq`, com 1 partição e retenção de 14 dias.
  - Vai para a DLQ só a mensagem que **nunca** vai ser processada: fora do contrato, ou que gera um erro de domínio.
  - Erros transitórios (banco fora, conflito de concorrência) são relançados, e o Kafka reentrega.
  - A mensagem na DLQ mantém chave, valor e headers originais, mais `dlq-original-topic`, `dlq-original-partition`, `dlq-original-offset` e `dlq-reason`.
- **Payload:** campos em camelCase. Ids são UUID em texto. Valores em dinheiro são `number` em reais, com até 2 casas decimais. Datas em ISO-8601 UTC.
- **Evolução:** adicionar campo opcional é compatível (os consumidores ignoram campos desconhecidos). Remover ou renomear campo, ou mudar o tipo, exige um tópico `vN+1`, e os dois convivem até nenhum consumidor usar o antigo.

---

## Contratos implementados e provisórios

### `catalog.product.created.v1`

**Estado:** Implementado · **Produtor:** catalog-service · **Consumidor:** compliance-service (group `compliance-service`, DLQ `compliance.product-created.dlq`)

Publicado uma vez por produto criado, tanto em `POST /products` quanto em cada item de `POST /products/import`. O produto nasce com análise `PENDING`.

| Campo | Tipo | Regra |
|---|---|---|
| `productId` | string (UUID) | id do produto no catalog |
| `sku` | string | maiúsculas, `^[A-Z0-9][A-Z0-9-]{2,49}$` |
| `name` | string | não vazio |
| `description` | string | não vazio |
| `price` | number | ≥ 0, em reais |
| `stock` | integer | ≥ 0, estoque inicial |

```json
{
  "productId": "0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10",
  "sku": "NB-001",
  "name": "Notebook",
  "description": "Notebook 16GB RAM",
  "price": 4500,
  "stock": 2
}
```

O consumidor exige os headers `ce_specversion`, `ce_id`, `ce_source` e `ce_type`. Mensagem sem eles, com `ce_type` diferente ou com dados inválidos vai para a DLQ. A deduplicação é por `ce_id` (`processed_events`).

### `produto.analisado.v1`

**Estado:** Implementado · **Produtor:** compliance-service · **Consumidor:** catalog-service (group `catalog-service-group`, DLQ `catalog.product-analysis.dlq`)

Resultado da cadeia de regras de conformidade: termos proibidos (bloqueante), teto de preço (100.000) e descrição mínima (20 caracteres).

| Campo | Tipo | Regra |
|---|---|---|
| `sku` | string | SKU do produto analisado (o catalog localiza o produto por ele) |
| `status` | `"APPROVED"` \| `"REJECTED"` | `REJECTED` quando há pelo menos uma violação |
| `violations` | array de `{ ruleCode, message }` | vazio quando aprovado. O catalog ignora este campo hoje |

```json
{
  "sku": "NB-002",
  "status": "REJECTED",
  "violations": [
    { "ruleCode": "PROHIBITED_TERMS", "message": "Name or description contains prohibited terms: replica." }
  ]
}
```

- A chave e o `ce_subject` são o `productId`.
- No catalog:
  - repetir o mesmo resultado não tem efeito;
  - um resultado que inverte uma análise já concluída é um conflito e vai para a DLQ;
  - um SKU desconhecido também vai para a DLQ.

### `catalog.product.approved.v1`

**Estado:** Provisório (publicado, sem consumidor) · **Produtor:** catalog-service · **Consumidor previsto:** marketplace-gateway (#21)

Publicado uma vez, quando a análise passa de `PENDING` para `APPROVED`. A partir daí o produto pode ser anunciado e vendido.

| Campo | Tipo |
|---|---|
| `productId` | string (UUID) |
| `sku` | string |

```json
{ "productId": "0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10", "sku": "NB-001" }
```

O evento não traz nome, preço nem estoque. O marketplace-gateway busca esses dados em `GET /products/sku/:sku` ou mantém uma projeção a partir de `catalog.product.created.v1`; a escolha é da ADR #12.

### `catalog.product.rejected.v1`

**Estado:** Implementado (sem consumidor) · **Produtor:** catalog-service

Publicado uma vez, quando a análise passa de `PENDING` para `REJECTED`. Tem o mesmo payload do `approved`. Não há consumidor previsto. O evento fica disponível para auditoria (persona Fiscal) e para relatórios.

### `catalog.product.stock-changed.v1`

**Estado:** Provisório (publicado, sem consumidor) · **Produtor:** catalog-service · **Consumidor previsto:** marketplace-gateway (#33)

Publicado sempre que o estoque de um produto muda por reserva ou devolução, na mesma transação da reserva.

| Campo | Tipo | Regra |
|---|---|---|
| `productId` | string (UUID) | |
| `sku` | string | |
| `stock` | integer | valor **absoluto** depois da mudança, não um delta |

```json
{ "productId": "0b8f2c1e-6a4d-4d1e-9a51-3f0f1b2c7d10", "sku": "NB-001", "stock": 0 }
```

Como o valor é absoluto, um consumidor que receba eventos repetidos converge para o último valor aplicado. Com `stock: 0`, o marketplace-gateway zera a disponibilidade do anúncio.

### `order.order.placed.v1`

**Estado:** Provisório (o consumidor existe, o produtor vem na #20) · **Produtor:** order-service · **Consumidor:** catalog-service (group `catalog-service-order-stock`, DLQ `catalog.order-stock.dlq`)

Publicado quando o order-service persiste um pedido novo. Pede a reserva do estoque.

| Campo | Tipo | Regra | Estado |
|---|---|---|---|
| `orderId` | string (UUID) | obrigatório | Provisório |
| `items` | array, mín. 1 | obrigatório | Provisório |
| `items[].sku` | string | não vazio | Provisório |
| `items[].quantity` | integer | > 0 | Provisório |
| `items[].unitPrice` | number | preço unitário de venda | Proposto (opcional) |
| `marketplace` | `"AMAZON"` \| `"MERCADO_LIVRE"` \| `"SHOPEE"` | origem do pedido | Proposto (opcional) |
| `externalOrderId` | string | id do pedido no marketplace | Proposto (opcional) |

```json
{
  "orderId": "6f1c2b8e-0000-4000-8000-000000000001",
  "marketplace": "MERCADO_LIVRE",
  "externalOrderId": "ML-2000001",
  "items": [{ "sku": "NB-001", "quantity": 1, "unitPrice": 4500 }]
}
```

- Os campos propostos são opcionais porque o catalog ignora campos desconhecidos. Incluí-los não quebra o consumidor atual e ajuda nos traces e nos relatórios.
- Regras no catalog (#30):
  - O pedido é reservado inteiro ou não é reservado.
  - Linhas do mesmo SKU são somadas, e `nb-001` e `NB-001` são o mesmo SKU.
  - SKU desconhecido, não aprovado ou malformado conta como `available: 0`, então o pedido sempre recebe uma resposta.
  - Idempotência por `orderId`: repetir o evento não muda nada.
  - Mensagem fora do contrato (JSON inválido, `orderId` que não é UUID, `items` vazio, `quantity` ≤ 0) vai para a DLQ.

### `order.order.cancelled.v1`

**Estado:** Provisório (o consumidor do catalog existe, o produtor vem na #20) · **Produtor:** order-service · **Consumidores:** catalog-service (devolve o estoque) e marketplace-gateway (cancela no marketplace, previsto)

| Campo | Tipo | Regra | Estado |
|---|---|---|---|
| `orderId` | string (UUID) | obrigatório | Provisório |
| `reason` | string | `OUT_OF_STOCK` \| `PAYMENT_FAILED` \| `MARKETPLACE_CANCELLED` | Provisório (opcional; valores propostos) |
| `marketplace` | string | como no `placed` | Proposto (opcional) |
| `externalOrderId` | string | como no `placed` | Proposto (opcional) |

```json
{
  "orderId": "6f1c2b8e-0000-4000-8000-000000000001",
  "reason": "PAYMENT_FAILED",
  "marketplace": "MERCADO_LIVRE",
  "externalOrderId": "ML-2000001"
}
```

- `OUT_OF_STOCK` vem da resposta `insufficient` (ADR-0004). `PAYMENT_FAILED` vem do billing. `MARKETPLACE_CANCELLED` é o cancelamento feito pelo comprador no marketplace, que depende da #22.
- O marketplace-gateway precisa de `marketplace` e `externalOrderId` para cancelar no marketplace certo; por isso a proposta de incluí-los.
- No catalog:
  - só uma reserva ainda `RESERVED` devolve estoque, e repetir o cancelamento não muda nada;
  - um cancelamento que chega antes do `placed` grava um tombstone, e o `placed` que chegar depois é ignorado.

### `catalog.stock.reserved.v1`

**Estado:** Provisório (publicado, o consumidor vem na #20/#29) · **Produtor:** catalog-service · **Consumidor previsto:** order-service

O estoque de todos os itens do pedido foi baixado. Com ele, o order-service confirma o pedido e publica `order.order.confirmed.v1`.

| Campo | Tipo | Regra |
|---|---|---|
| `orderId` | string (UUID) | |
| `items` | array de `{ sku, quantity }` | SKUs em maiúsculas, linhas repetidas somadas |

```json
{ "orderId": "6f1c2b8e-0000-4000-8000-000000000001", "items": [{ "sku": "NB-001", "quantity": 1 }] }
```

### `catalog.stock.insufficient.v1`

**Estado:** Provisório (publicado, o consumidor vem na #20/#29) · **Produtor:** catalog-service · **Consumidor previsto:** order-service

Algum item não tinha estoque, e nada foi baixado. O order-service cancela o pedido com `reason: OUT_OF_STOCK`.

| Campo | Tipo | Regra |
|---|---|---|
| `orderId` | string (UUID) | |
| `items` | array de `{ sku, requested, available }` | todos os itens que faltam, não só o primeiro |

```json
{
  "orderId": "6f1c2b8e-0000-4000-8000-000000000002",
  "items": [{ "sku": "NB-001", "requested": 2, "available": 1 }]
}
```

## Como adicionar ou mudar um evento

1. Abrir um PR alterando este arquivo, com a ficha do evento no estado **Proposto**, e marcar os donos do produtor e dos consumidores.
2. Com a aprovação, adicionar o tópico (e a DLQ do consumidor) em `docker/kafka/create-topics.sh`.
3. No produtor: domain event, mapeamento para o evento de integração (`infra/messaging/<agregado>.integration-events.ts` nos serviços Node) e publicação via outbox.
4. No consumidor: validar o payload (zod/pydantic) no adapter, deduplicar e mandar para a DLQ o que nunca vai ser processado.
5. Quando o código entrar na `dev`, mudar o estado da ficha para **Implementado** (ou **Provisório**, se só um lado existir).
