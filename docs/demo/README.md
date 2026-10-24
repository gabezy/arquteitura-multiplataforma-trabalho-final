# Roteiro da demo ponta a ponta

Roteiro reproduzível da demo do omni-market (apresentação de 28/10, #27). Não há frontend: a demo roda pelo BFF (coleção `.http` ou `curl`), pelo Kafka UI e pelo Grafana.

**Duração:** cerca de 15 minutos, mais a preparação (feita antes da apresentação).

| Arquivo | Para quê |
|---|---|
| `README.md` | Este roteiro |
| `omni-market.http` | Todas as requisições da demo, na ordem dos atos ([VS Code REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)) |
| `catalog-demo.xlsx` | Planilha da demo: 5 produtos hospitalares, um caso para cada desfecho do compliance |

## O que a demo mostra

| Ato | Fluxo | Tema da disciplina |
|---|---|---|
| 1. Autenticação | Token no Keycloak por papel; o BFF nega sem token (401) e sem papel (403) | IdP, BFF |
| 2. Importação | Planilha → BFF → catalog-service | BFF, Clean/Hexagonal Architecture |
| 3. Compliance | catalog → Kafka → compliance → Kafka → catalog; 2 aprovados e 3 reprovados | Eventos, outbox, chain of responsibility |
| 4. Estoque | Pedido → reserva, falta de estoque e devolução no catalog | Saga por coreografia (ADR-0004), idempotência |
| 5. Observabilidade | Trace único atravessando BFF, catalog e compliance; logs correlacionados | OpenTelemetry, Grafana |
| 6. Pedido e cobrança | marketplace → order → billing, ou o plano B | Coreografia completa (`docs/eventos.md`) |

## Pré-requisitos

- Docker com Docker Compose e cerca de 8 GB de memória livres para o Docker. São mais de 15 containers.
- Portas livres: 8080 (BFF), 8082 a 8085, 8089, 8090, 3000, 4317, 4318, 5432 a 5434 e 9092. Se a 8080 ou a 3000 estiverem ocupadas, use `BFF_PORT` e `GRAFANA_PORT` (ver o README da raiz).
- `make`. Sem ele, use os comandos `docker compose` indicados ao lado.
- VS Code com a extensão REST Client para a coleção, ou `curl`.
- No Windows: leia [Problemas comuns](#problemas-comuns) antes de começar.

## Preparação (antes da apresentação)

Faça do zero, para não carregar dados de testes anteriores. A planilha da demo só pode ser importada uma vez por ambiente (ver o ato 2).

```bash
make clean && make up
# sem make: docker compose down -v && docker compose up -d --build
```

- A primeira execução constrói as imagens das aplicações e leva alguns minutos. Nas seguintes, o ambiente fica pronto em cerca de 1 minuto.
- O Keycloak é o mais lento, porque monta a configuração otimizada na primeira subida.

Confira a saúde de cada serviço (tudo `UP`):

```bash
make ps     # sem make: docker compose ps
curl -s localhost:8080/actuator/health   # bff-gateway
curl -s localhost:8082/health            # catalog-service
curl -s localhost:8083/health            # compliance-service
curl -s localhost:8084/health            # order-service
```

Deixe abertas três abas:

| Aba | Endereço | Credenciais |
|---|---|---|
| Kafka UI | http://localhost:8090 | — |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| Coleção | `docs/demo/omni-market.http` no VS Code (cole o `BFF_CLIENT_SECRET` do `.env` na variável `clientSecret`) | — |

## Ato 1: autenticação

**Mensagem:** o BFF é a porta de entrada única da API. Ele valida o JWT emitido pelo Keycloak e autoriza por papel do realm (`admin`, `customer`).

Na coleção, rode as requisições do ato 1: os tokens do `admin` e do `customer`, depois a importação sem token e com o `customer`. Com `curl`:

```bash
set -a; . ./.env; set +a   # o client secret do BFF é gerado pelo make env (BFF_CLIENT_SECRET)
token() {
  curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
    -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
    -d username="$1" -d password="$1" | sed -E 's/.*"access_token":"([^"]+)".*/\1/'
}
ADMIN=$(token admin); CUSTOMER=$(token customer)

curl -s -o /dev/null -w '%{http_code}\n' -F file=@docs/demo/catalog-demo.xlsx localhost:8080/catalog/import/xlsx
curl -s -H "Authorization: Bearer $CUSTOMER" -F file=@docs/demo/catalog-demo.xlsx localhost:8080/catalog/import/xlsx
```

**Resultado esperado** (ensaio de 24/10):

```text
401
{"detail":"Access denied","instance":"/catalog/import/xlsx","status":403,"title":"Forbidden"}
```

## Ato 2: importação da planilha

**Mensagem:** a loja importa o catálogo por planilha. O BFF lê o xlsx e envia os produtos ao catalog-service, que grava os produtos e os eventos na mesma transação (outbox, ADR-0002).

Mostre a planilha antes: 5 produtos hospitalares, com estoque inicial.

| SKU | Produto | Preço | Estoque | Desfecho esperado no compliance |
|---|---|---|---|---|
| `OXI-001` | Oxímetro de pulso portátil | 189,90 | 2 | Aprovado (usado no ato 4) |
| `MON-002` | Monitor multiparamétrico | 18.500,00 | 5 | Aprovado |
| `EST-003` | Estetoscópio **réplica** premium | 320,00 | 10 | Reprovado: termo proibido |
| `RES-004` | Ressonância magnética 1.5T | **2.500.000,00** | 1 | Reprovado: preço acima do teto (100.000) |
| `LUV-005` | Luvas de procedimento ("Caixa com 100 un.") | 39,90 | 50 | Reprovado: descrição com menos de 20 caracteres |

```bash
curl -s -H "Authorization: Bearer $ADMIN" -F file=@docs/demo/catalog-demo.xlsx localhost:8080/catalog/import/xlsx
```

**Resultado esperado:** `{"importedProducts":5}`

Importar a mesma planilha de novo responde **500**: os SKUs já existem, e o BFF ainda não traduz o 409 do catalog. Não repita este ato. Para recomeçar, rode `make clean && make up`.

## Ato 3: análise de conformidade

**Mensagem:**
- O catalog publicou `catalog.product.created.v1`.
- O compliance analisou cada produto com uma cadeia de regras (termos proibidos, teto de preço, descrição mínima) e publicou o resultado em `produto.analisado.v1`.
- O catalog consumiu o resultado e atualizou o status.
- Tudo assíncrono, com entrega *at-least-once* e consumidores idempotentes.

1. No **Kafka UI**, abra *Topics → catalog.product.created.v1 → Messages*: são 5 mensagens. Abra uma e mostre os headers `ce_*` (CloudEvents) e o `traceparent`.
2. Abra *Topics → produto.analisado.v1 → Messages*: as violações de cada produto reprovado.
3. Consulte o status no catalog, pela coleção ou com `curl`:

```bash
for sku in OXI-001 MON-002 EST-003 RES-004 LUV-005; do curl -s localhost:8082/products/sku/$sku; echo; done
```

**Resultado esperado:** `analysisStatus` `APPROVED` para `OXI-001` e `MON-002`, e `REJECTED` para os outros três. Em `produto.analisado.v1`:

```json
{"sku": "EST-003", "status": "REJECTED", "violations": [{"ruleCode": "PROHIBITED_TERMS", "message": "Name or description contains prohibited terms: replica."}]}
{"sku": "RES-004", "status": "REJECTED", "violations": [{"ruleCode": "PRICE_CEILING", "message": "Price 2500000 exceeds the ceiling of 100000."}]}
{"sku": "LUV-005", "status": "REJECTED", "violations": [{"ruleCode": "DESCRIPTION_REQUIRED", "message": "Description must have at least 20 characters."}]}
```

## Ato 4: reserva de estoque

**Mensagem:** o catalog é o dono do estoque (ADR-0004). Ele reserva ou devolve unidades reagindo aos eventos do pedido, sem chamada síncrona entre os serviços:

- o pedido é reservado inteiro ou não é reservado;
- repetir um evento não muda nada;
- produto reprovado não pode ser vendido.

Enquanto o order-service não publica os pedidos (#20), os eventos `order.order.*` são publicados à mão. Esse é o plano B deste ato, e ele é suficiente para mostrar o comportamento do catalog.

Publique cada evento pelo **Kafka UI** (*Topics → \<tópico\> → Produce Message*, com `Key` e `Value` abaixo) ou pela coleção (ato 4), que usa a API do Kafka UI.

| Passo | Tópico | Key | Value | Estoque de `OXI-001` | Resposta do catalog |
|---|---|---|---|---|---|
| Venda | `order.order.placed.v1` | `6f1c2b8e-0000-4000-8000-000000000001` | `{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","items":[{"sku":"OXI-001","quantity":1}]}` | 2 → **1** | `catalog.stock.reserved.v1` e `catalog.product.stock-changed.v1` (`stock: 1`) |
| Falta estoque | `order.order.placed.v1` | `6f1c2b8e-0000-4000-8000-000000000002` | `{"orderId":"6f1c2b8e-0000-4000-8000-000000000002","items":[{"sku":"OXI-001","quantity":2}]}` | 1 (não muda) | `catalog.stock.insufficient.v1` (`available: 1`, `requested: 2`) |
| Produto reprovado | `order.order.placed.v1` | `6f1c2b8e-0000-4000-8000-000000000003` | `{"orderId":"6f1c2b8e-0000-4000-8000-000000000003","items":[{"sku":"EST-003","quantity":1}]}` | — | `catalog.stock.insufficient.v1` (`available: 0`) |
| Cancelamento | `order.order.cancelled.v1` | `6f1c2b8e-0000-4000-8000-000000000001` | `{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","reason":"PAYMENT_FAILED"}` | 1 → **2** | `catalog.product.stock-changed.v1` (`stock: 2`) |

Depois de cada passo, confira o estoque com `curl -s localhost:8082/products/sku/OXI-001` e mostre as respostas no Kafka UI, nos tópicos `catalog.stock.*` e `catalog.product.stock-changed.v1`.

**Resultado esperado** (ensaio de 24/10), com a chave antes do valor:

```text
6f1c2b8e-…-000000000001  {"items":[{"sku":"OXI-001","quantity":1}],"orderId":"6f1c2b8e-…-000000000001"}
6f1c2b8e-…-000000000002  {"items":[{"sku":"OXI-001","available":1,"requested":2}],"orderId":"6f1c2b8e-…-000000000002"}
6f1c2b8e-…-000000000003  {"items":[{"sku":"EST-003","available":0,"requested":1}],"orderId":"6f1c2b8e-…-000000000003"}
<productId>               {"sku":"OXI-001","stock":1,"productId":"<productId>"}
<productId>               {"sku":"OXI-001","stock":2,"productId":"<productId>"}
```

Para mostrar a idempotência, publique a venda de novo com a mesma key: o estoque não muda. Mais cenários estão em [`docs/demo-estoque.md`](../demo-estoque.md).

## Ato 5: observabilidade

**Mensagem:** os serviços (Java, Node e Python) exportam traces, métricas e logs por OpenTelemetry. O contexto do trace atravessa HTTP e Kafka, então a importação inteira aparece como um único trace.

1. No **Grafana**, abra *Explore → Tempo → Search*, com *Service Name* `bff-gateway` e *Span Name* `http post /catalog/import/xlsx`.
2. Abra o trace da importação (cerca de 2 s). Mostre a cascata:
   - `bff-gateway`: autenticação e chamada ao catalog;
   - `catalog-service`: `POST /products/import`, os inserts no banco e na outbox, e a publicação no Kafka;
   - `compliance-service`: `catalog.product.created.v1 process`, as queries e o `produto.analisado.v1 send`.
3. Em um span, use *Logs for this span* para saltar aos logs correlacionados no Loki.

**Resultado esperado** (ensaio de 24/10): o trace da importação tinha 117 spans, sendo 8 do bff-gateway, 74 do catalog-service e 35 do compliance-service.

## Ato 6: pedido e cobrança

**Mensagem:** é o fluxo completo de [`docs/eventos.md`](../eventos.md): o marketplace envia o pedido, o order-service publica `order.order.placed.v1`, o catalog reserva, o pedido é confirmado e o billing cobra.

Antes da apresentação (27/10), confira o que entrou na `dev` e escolha o caminho de cada etapa:

| Etapa | Pronto quando | Se estiver pronto | Plano B |
|---|---|---|---|
| Pedido chega do marketplace | marketplace-gateway publica `marketplace.order.received.v1` (#22) | Disparar o pedido no simulador do marketplace (#25) | Publicar `marketplace.order.received.v1` à mão no Kafka UI, se o order já consumir; senão, usar o ato 4 |
| Pedido persistido e publicado | order-service consome o pedido e publica `order.order.placed.v1` (#20) | Mostrar o pedido na API do order e o evento no Kafka UI | Ato 4 (pedido publicado à mão) |
| Pedido confirmado | order-service consome `catalog.stock.reserved.v1` e publica `order.order.confirmed.v1` (#20, #29) | Mostrar o evento no Kafka UI | Mostrar o diagrama de sequência de `docs/eventos.md` |
| Cobrança | billing-service consome `order.order.confirmed.v1` e publica `billing.invoice.issued.v1` (#23) | Mostrar a cobrança na API do billing e o evento | Mostrar o contrato proposto em `docs/eventos.md` |

Mensagem de exemplo para o plano B de `marketplace.order.received.v1` (contrato proposto, a confirmar na #8):

```json
{"marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001","items":[{"sku":"MON-002","quantity":1,"unitPrice":18500}],"total":18500,"orderedAt":"2026-10-28T13:05:00Z"}
```

Key: `MERCADO_LIVRE:ML-2000001`.

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Build falha com `invalid peer certificate: UnknownIssuer` (uv, npm ou Maven) | Antivírus com inspeção de HTTPS (ex.: Avast Web Shield) reassina os certificados, e os containers não confiam na raiz dele | Desligar a varredura HTTPS do antivírus durante o build (no Avast: *Configurações → Proteção → Escudos principais → Escudo da Web → Ativar varredura HTTPS*). As imagens ficam em cache depois |
| `kafka-init` sai com código 2 (`set: illegal option -`), e as aplicações ficam em `Created` | No Windows, o Git com `core.autocrlf=true` extrai `docker/kafka/create-topics.sh` com CRLF | Converter o arquivo para LF (`sed -i 's/\r$//' docker/kafka/create-topics.sh`) e rodar `make up` de novo |
| `docker exec kafka /opt/kafka/...` falha com `C:/Program Files/Git/opt/...` | O Git Bash converte caminhos que começam com `/` | Rodar `export MSYS_NO_PATHCONV=1` antes |
| Importação responde 500 | SKUs da planilha já importados | `make clean && make up`, ou trocar os SKUs da planilha |
| Usuário ou papel novo não aparece no Keycloak | O realm só é importado num volume novo | `make clean && make up` |
| Porta 8080 ou 3000 ocupada | Outro projeto na mesma porta | `BFF_PORT=8081 GRAFANA_PORT=3001 make up`, e ajustar `@bff` na coleção |
| Mensagem publicada à mão vai para `catalog.order-stock.dlq` | Valor fora do contrato (ex.: campo `content` em vez de `value` na API do Kafka UI, JSON inválido, `orderId` que não é UUID) | Conferir o valor. O motivo está no header `dlq-reason` da mensagem na DLQ |
