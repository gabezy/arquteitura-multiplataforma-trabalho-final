# Roteiro da demo ponta a ponta

Roteiro reproduzível da demo do omni-market (apresentação de 28/10, #28). Não há frontend: a demo roda pelo BFF (coleção `.http` ou `curl`), pelo Kafka UI e pelo Grafana. Todos os serviços estão prontos, então o fluxo é real do anúncio à cobrança, e os eventos publicados à mão ficaram como [plano B](#plano-b).

**Duração:** cerca de 15 minutos, mais a preparação (feita antes da apresentação).

| Arquivo | Para quê |
|---|---|
| `README.md` | Este roteiro |
| `omni-market.http` | As requisições da demo, na ordem dos atos ([VS Code REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)) |
| `catalog-demo.xlsx` | Planilha da demo: 5 produtos hospitalares, um caso para cada desfecho do compliance |

## O que a demo mostra

| Ato | Fluxo | Tema da disciplina |
|---|---|---|
| 1. Autenticação | Token no Keycloak por persona; o BFF nega sem token (401) e sem papel (403) | IdP, BFF |
| 2. Importação | Planilha → BFF → catalog-service, com os eventos gravados na outbox | BFF, Clean Architecture, outbox |
| 3. Compliance | catalog → Kafka → compliance → Kafka → catalog; 2 aprovados e 3 reprovados | Eventos, chain of responsibility |
| 4. Anúncios | Aprovado → marketplace-gateway → Amazon, Mercado Livre e Shopee | Anti-corruption layer, adapter |
| 5. Pedido pago | Marketplace → gateway (polling) → order → catalog (reserva) → billing → PSP | Saga por coreografia, inbox e outbox |
| 6. Recusa e falta de estoque | PSP recusa e o estoque volta; pedido maior que o estoque é cancelado no marketplace | Compensação da saga |
| 7. Preço e relatório | A Loja muda o preço e os anúncios acompanham; o CSM vê as vendas por marketplace | Eventos, BFF por persona |
| 8. Observabilidade | Dashboard e traces que atravessam os serviços | OpenTelemetry, Grafana |

## Pré-requisitos

- Docker com cerca de 8 GB de memória livres. O Compose sobe mais de 20 containers.
- Portas livres: 8080 (BFF), 8082 a 8087, 8089, 8090, 3000, 4317, 4318 e 9092. O Compose usa também 5432 a 5436, 6379 e 8200, e nele `BFF_PORT` e `GRAFANA_PORT` trocam a 8080 e a 3000 (ver o README da raiz). No kind, o BFF fica sempre na 8080.
- `make`, `curl` e `jq`.
- VS Code com a extensão REST Client para a coleção, ou só o terminal.
- No Windows: leia [Problemas comuns](#problemas-comuns) antes de começar.

## Preparação (antes da apresentação)

Suba do zero, para não carregar dados de testes anteriores. A planilha da demo só pode ser importada uma vez por ambiente (ver o ato 2).

```bash
make act-destroy && make act-deploy        # kind, pelo workflow local (ou make k8s-destroy && make k8s-deploy)
make compose-clean && make compose-up      # ou Docker Compose
```

- A primeira execução constrói as imagens e leva alguns minutos. O Keycloak e o `kafka-init`, que cria os tópicos um a um, são os mais lentos.
- No ensaio, rode antes o teste ponta a ponta (`make e2e-k8s` ou `make e2e`, com `E2E_SKIP_UP=1` se o ambiente já estiver no ar). Ele percorre o mesmo fluxo com SKUs próprios. Depois suba do zero de novo, porque os pedidos e as faturas do teste aparecem nas listas da demo.

Confira a saúde de cada serviço (tudo `UP`):

```bash
curl -s localhost:8080/actuator/health                                # bff-gateway
for port in 8082 8083 8084 8086 8087; do curl -s localhost:$port/health; echo; done   # catalog, compliance, order, billing, marketplace
```

Deixe abertas três abas:

| Aba | Endereço | Credenciais |
|---|---|---|
| Kafka UI | http://localhost:8090 | — |
| Grafana | http://localhost:3000, dashboard **Omni Market - Serviços** (pasta Omni Market) | `admin` / `admin` |
| Coleção | `docs/demo/omni-market.http` no VS Code (cole o `BFF_CLIENT_SECRET` do `.env` na variável `clientSecret`) | — |

No terminal, na raiz do repositório, carregue as funções da demo:

```bash
set -a; . ./.env; set +a   # BFF_CLIENT_SECRET, gerado pelo make env (e BFF_PORT, se você o trocou)
BFF=http://localhost:${BFF_PORT:-8080}   # no kind: BFF=http://localhost:8080
token() {
  curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
    -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
    -d username="$1" -d password="$1" | jq -r .access_token
}
bff() { # bff <usuário> <caminho> [opções do curl]: o token vale 5 min, então cada chamada pede um novo
  local user=$1 path=$2; shift 2
  curl -s -H "Authorization: Bearer $(token "$user")" "$@" "$BFF$path"
}
product() { curl -s "localhost:8082/products/sku/$1" | jq -c '{sku, analysisStatus, price, stock}'; }
```

As leituras pelo BFF ficam 30 s em cache no Redis ([ADR-0012](../adr/0012-cache-distribuido-no-bff-gateway.md)). Por isso o roteiro espera o desfecho antes de cada consulta: uma lista consultada antes da hora só muda depois desses 30 s.

## Ato 1: autenticação

**Mensagem:** o BFF é a porta de entrada única da API. Ele valida o JWT emitido pelo Keycloak e autoriza por papel, e cada persona do C4 é um papel do realm ([matriz de permissões](../matriz-de-permissoes.md)).

Na coleção, rode as requisições do ato 1. Com `curl`: a importação sem token, a importação com o CSM, que só lê, e os pedidos com o Especialista, que não os vê.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -F file=@docs/demo/catalog-demo.xlsx $BFF/catalog/import/xlsx
bff csm /catalog/import/xlsx -F file=@docs/demo/catalog-demo.xlsx; echo
bff especialista /orders; echo
```

**Resultado esperado** (ensaio de 28/10):

```text
401
{"detail":"Access denied","instance":"/catalog/import/xlsx","status":403,"title":"Forbidden"}
{"detail":"Access denied","instance":"/orders","status":403,"title":"Forbidden"}
```

## Ato 2: importação da planilha

**Mensagem:** a Loja importa o catálogo por planilha. O BFF lê o xlsx e envia os produtos ao catalog-service, que grava os produtos e os eventos na mesma transação (outbox, [ADR-0002](../adr/0002-outbox-para-eventos-do-catalog-service.md)).

Mostre a planilha antes: 5 produtos hospitalares, com estoque inicial.

| SKU | Produto | Preço | Estoque | Desfecho esperado no compliance |
|---|---|---|---|---|
| `OXI-001` | Oxímetro de pulso portátil | 189,90 | 2 | Aprovado (vendido nos atos 5 e 6) |
| `MON-002` | Monitor multiparamétrico | 18.500,00 | 5 | Aprovado (pagamento recusado no ato 6) |
| `EST-003` | Estetoscópio **réplica** premium | 320,00 | 10 | Reprovado: termo proibido |
| `RES-004` | Ressonância magnética 1.5T | **2.500.000,00** | 1 | Reprovado: preço acima do teto (100.000) |
| `LUV-005` | Luvas de procedimento ("Caixa com 100 un.") | 39,90 | 50 | Reprovado: descrição com menos de 20 caracteres |

```bash
bff loja /catalog/import/xlsx -F file=@docs/demo/catalog-demo.xlsx; echo
```

**Resultado esperado:** `{"importedProducts":5}`

Importar a mesma planilha de novo responde **502**: os SKUs já existem, e o BFF ainda não traduz o 409 do catalog. Não repita este ato. Para recomeçar, suba o ambiente do zero.

## Ato 3: análise de conformidade

**Mensagem:**
- O catalog publicou `catalog.product.created.v1`.
- O compliance analisou cada produto com uma cadeia de regras (termos proibidos, teto de preço, descrição mínima) e publicou o resultado em `produto.analisado.v1`.
- O catalog consumiu o resultado, atualizou o status e publicou `catalog.product.approved.v1` ou `catalog.product.rejected.v1`.
- Tudo assíncrono, com entrega *at-least-once* e consumidores idempotentes.

1. No **Kafka UI**, abra *Topics → catalog.product.created.v1 → Messages*: são 5 mensagens. Abra uma e mostre os headers `ce_*` (CloudEvents) e o `traceparent`.
2. Abra *Topics → produto.analisado.v1 → Messages*: as violações de cada produto reprovado.
3. Consulte o status no catalog:

```bash
for sku in OXI-001 MON-002 EST-003 RES-004 LUV-005; do product $sku; done
```

Com o ambiente recém-subido, a primeira análise leva alguns segundos a mais. Se algum produto ainda estiver `PENDING`, consulte de novo depois dos passos 1 e 2. Não siga para o ato 5 antes de o `OXI-001` estar `APPROVED`: o catalog não reserva produto ainda pendente, e o pedido seria cancelado por falta de estoque.

**Resultado esperado** (ensaio de 28/10):

```text
{"sku":"OXI-001","analysisStatus":"APPROVED","price":189.9,"stock":2}
{"sku":"MON-002","analysisStatus":"APPROVED","price":18500,"stock":5}
{"sku":"EST-003","analysisStatus":"REJECTED","price":320,"stock":10}
{"sku":"RES-004","analysisStatus":"REJECTED","price":2500000,"stock":1}
{"sku":"LUV-005","analysisStatus":"REJECTED","price":39.9,"stock":50}
```

Em `produto.analisado.v1`:

```json
{"sku": "EST-003", "status": "REJECTED", "violations": [{"ruleCode": "PROHIBITED_TERMS", "message": "Name or description contains prohibited terms: replica."}]}
{"sku": "RES-004", "status": "REJECTED", "violations": [{"ruleCode": "PRICE_CEILING", "message": "Price 2500000 exceeds the ceiling of 100000."}]}
{"sku": "LUV-005", "status": "REJECTED", "violations": [{"ruleCode": "DESCRIPTION_REQUIRED", "message": "Description must have at least 20 characters."}]}
```

## Ato 4: anúncios nos marketplaces

**Mensagem:** o produto aprovado vira anúncio nos três marketplaces. O marketplace-gateway lê o produto no catalog ([ADR-0011](../adr/0011-dados-do-produto-por-consulta-ao-catalog.md)) e fala com cada marketplace por um adapter próprio, atrás de uma porta única (anti-corruption layer, [ADR-0008](../adr/0008-anticorruption-layer-um-adapter-por-marketplace.md)), com retry e circuit breaker ([ADR-0009](../adr/0009-resiliencia-nas-chamadas-aos-marketplaces.md)). O reprovado não é anunciado.

```bash
bff loja '/listings?sku=OXI-001' | jq -c '.listings[] | {marketplace, status, price, stock}'
bff loja '/listings?sku=EST-003' | jq -c .listings
```

Os anúncios saem uns 5 s depois da aprovação. Se a primeira lista vier vazia, espere 30 s, porque o BFF guardou a resposta vazia em cache, e consulte de novo.

**Resultado esperado** (ensaio de 28/10):

```text
{"marketplace":"AMAZON","status":"PUBLISHED","price":189.9,"stock":2}
{"marketplace":"MERCADO_LIVRE","status":"PUBLISHED","price":189.9,"stock":2}
{"marketplace":"SHOPEE","status":"PUBLISHED","price":189.9,"stock":2}
[]
```

No Kafka UI, `marketplace.listing.published.v1` tem 6 mensagens: os dois aprovados nos três marketplaces.

## Ato 5: pedido pago

**Mensagem:** a venda acontece no marketplace:
- o gateway busca os pedidos novos de cada marketplace a cada 5 s ([ADR-0010](../adr/0010-pedidos-dos-marketplaces-por-polling.md)) e publica `marketplace.order.received.v1`;
- o order-service registra o pedido e publica `order.order.placed.v1`, e o catalog reserva o estoque (saga por coreografia, [ADR-0004](../adr/0004-catalog-dono-do-estoque-com-reserva-por-coreografia.md));
- com a reserva, o pedido é confirmado, e o billing emite a fatura com a comissão do marketplace e cobra no PSP ([ADR-0005](../adr/0005-escopo-da-cobranca.md), [ADR-0007](../adr/0007-integracao-assincrona-com-o-psp.md)).

`scripts/simulate-order.sh` registra o pedido no simulador do marketplace, no formato dele. Venda de 1 oxímetro no Mercado Livre:

```bash
scripts/simulate-order.sh mercadolivre --sku OXI-001 --qty 1 --price 189.90
sleep 15
bff csm '/orders?marketplace=MERCADO_LIVRE' | jq -c '.orders[] | {externalOrderId, status, total}'
bff fiscal '/invoices?marketplace=MERCADO_LIVRE' | jq -c '.invoices[] | {status, amount, commissionPercent, commissionAmount, netAmount}'
product OXI-001
```

**Resultado esperado** (ensaio de 28/10; o id do pedido muda a cada execução):

```text
mercadolivre: pedido 2012805104 (1 x OXI-001, total R$ 189.90)
{"externalOrderId":"2012805104","status":"PAID","total":189.9}
{"status":"PAID","amount":189.90,"commissionPercent":11.00,"commissionAmount":20.89,"netAmount":169.01}
{"sku":"OXI-001","analysisStatus":"APPROVED","price":189.9,"stock":1}
```

O pedido fica `PAID` em cerca de 10 s. A fatura guarda a comissão do Mercado Livre (11%) e o líquido da loja. No Kafka UI, os tópicos do caminho, em ordem: `marketplace.order.received.v1`, `order.order.placed.v1`, `catalog.stock.reserved.v1`, `order.order.confirmed.v1`, `billing.invoice.issued.v1` e `billing.payment.confirmed.v1`.

## Ato 6: pagamento recusado e falta de estoque

**Mensagem:** a saga também se desfaz. O PSP simulado recusa cobranças de R$ 100.000,00 ou mais: a fatura falha, o order-service cancela o pedido e o catalog devolve o estoque. Um pedido maior que o estoque é cancelado sem baixar nada. Nos dois casos, o gateway cancela o pedido no marketplace.

```bash
scripts/simulate-order.sh shopee --sku MON-002 --qty 2 --price 60000    # R$ 120.000,00: o PSP recusa
scripts/simulate-order.sh amazon --sku OXI-001 --qty 5 --price 189.90   # 5 unidades, com 1 em estoque
sleep 15
bff csm /orders | jq -c '.orders[] | {marketplace, status, cancellationReason, total}'
bff fiscal '/invoices?status=PAYMENT_FAILED' | jq -c '.invoices[] | {marketplace, amount, commissionAmount, failureReason}'
product MON-002; product OXI-001
```

**Resultado esperado** (ensaio de 28/10; a ordem dos dois primeiros pedidos pode variar):

```text
{"marketplace":"AMAZON","status":"CANCELLED","cancellationReason":"OUT_OF_STOCK","total":949.5}
{"marketplace":"SHOPEE","status":"CANCELLED","cancellationReason":"PAYMENT_FAILED","total":120000}
{"marketplace":"MERCADO_LIVRE","status":"PAID","cancellationReason":null,"total":189.9}
{"marketplace":"SHOPEE","amount":120000.00,"commissionAmount":16800.00,"failureReason":"INSUFFICIENT_FUNDS"}
{"sku":"MON-002","analysisStatus":"APPROVED","price":18500,"stock":5}
{"sku":"OXI-001","analysisStatus":"APPROVED","price":189.9,"stock":1}
```

O MON-002 foi reservado (5 → 3) e devolvido (3 → 5), e o OXI-001 não mudou. Os cancelamentos chegaram aos simuladores (a ordem das linhas também pode variar):

```bash
curl -s 'localhost:8089/__admin/requests?limit=100' | jq -r '.requests[] | select(.request.url | test("cancel")) | "\(.request.method) \(.request.url)"'
```

```text
POST /amazon/orders/v0/orders/701-7631397-9072027/cancellation
POST /shopee/api/v2/order/cancel_order?shop_id=1001
```

## Ato 7: preço e relatório

**Mensagem:** a Loja muda o preço pelo BFF. O catalog publica `catalog.product.price-changed.v1`, e o gateway atualiza os três anúncios sem chamar o marketplace dentro do consumer. O CSM acompanha as vendas por marketplace, e o relatório conta só os pedidos confirmados ou pagos.

```bash
bff loja /catalog/products/OXI-001/price -X PATCH -H 'Content-Type: application/json' -d '{"price":179.90}' -o /dev/null -w '%{http_code}\n'
sleep 5
bff loja '/listings?sku=OXI-001' | jq -c '.listings[] | {marketplace, status, price, stock}'
bff csm "/reports/sales-by-marketplace?from=$(date -u +%F)&to=$(date -u +%F)" | jq -c '.marketplaces[]'
```

**Resultado esperado** (ensaio de 28/10):

```text
204
{"marketplace":"AMAZON","status":"PUBLISHED","price":179.9,"stock":1}
{"marketplace":"MERCADO_LIVRE","status":"PUBLISHED","price":179.9,"stock":1}
{"marketplace":"SHOPEE","status":"PUBLISHED","price":179.9,"stock":1}
{"marketplace":"AMAZON","orders":0,"units":0,"totalAmount":0}
{"marketplace":"MERCADO_LIVRE","orders":1,"units":1,"totalAmount":189.9}
{"marketplace":"SHOPEE","orders":0,"units":0,"totalAmount":0}
```

Os anúncios mostram também o estoque que o ato 5 baixou. A troca de preço limpa o cache de anúncios do BFF, então a consulta logo depois já vem atualizada.

## Ato 8: observabilidade

**Mensagem:** os serviços (Java, Node.js, Python e Go) exportam traces, métricas e logs por OpenTelemetry. O contexto do trace atravessa HTTP e Kafka, então cada fluxo aparece como um trace só.

1. No dashboard **Omni Market - Serviços**, mostre a latência entre os serviços (P50 a P99), os erros, as mensagens em DLQ (nenhuma nesta demo), os aprovados e reprovados do compliance e o hardware de cada container.
2. Em *Explore → Tempo → Search*, com *Service Name* `bff-gateway` e *Span Name* `http post /catalog/import/xlsx`, abra o trace mais longo: é a importação da Loja (o outro é o 403 do CSM). Ele atravessa o bff-gateway, o catalog-service, o compliance-service e o marketplace-gateway. No ensaio de 28/10 foram cerca de 240 spans (9 do bff-gateway, 100 do catalog-service, 35 do compliance-service e 98 do marketplace-gateway), em 2,5 s a 7 s: a primeira importação depois de subir o ambiente é a mais lenta.
3. Com *Service Name* `billing-service` e *Span Name* `order.order.confirmed.v1 process`, abra o trace de um pedido. Ele começa em `poll orders MERCADO_LIVRE`, no marketplace-gateway, e passa pelo order-service, pelo catalog-service e pelo billing-service (cerca de 80 spans no ensaio). O resultado do pagamento é outro trace, que começa no webhook do PSP (*Span Name* `POST /webhooks/psp`).
4. Em um span, use *Logs for this span* para saltar aos logs correlacionados no Loki.

## Plano B

Se um serviço não estiver de pé na hora:

- Mostre a saída do `make e2e` (ou `make e2e-k8s`) do ensaio: cada etapa do fluxo imprime `[OK]`, da autenticação à devolução do estoque.
- Para o estoque do catalog sozinho, publique os eventos de pedido à mão pelo Kafka UI, como em [`docs/demo-estoque.md`](../demo-estoque.md). A coleção traz essas requisições no fim.
- Para o ciclo do pedido sem o marketplace-gateway, publique `marketplace.order.received.v1` à mão, como em [`docs/demo-pedidos.md`](../demo-pedidos.md).
- Sem nenhum ambiente, mostre o diagrama de sequência de [`docs/eventos.md`](../eventos.md#fluxo-principal).

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Build falha com `invalid peer certificate: UnknownIssuer` (uv, npm ou Maven) | Antivírus com inspeção de HTTPS (ex.: Avast Web Shield) reassina os certificados, e os containers não confiam na raiz dele | Desligar a varredura HTTPS do antivírus durante o build (no Avast: *Configurações → Proteção → Escudos principais → Escudo da Web → Ativar varredura HTTPS*). As imagens ficam em cache depois |
| `kafka-init` sai com código 2 (`set: illegal option -`), e as aplicações ficam em `Created` | No Windows, o Git com `core.autocrlf=true` extrai `docker/kafka/create-topics.sh` com CRLF | Converter o arquivo para LF (`sed -i 's/\r$//' docker/kafka/create-topics.sh`) e subir de novo |
| `docker exec kafka /opt/kafka/...` falha com `C:/Program Files/Git/opt/...` | O Git Bash converte caminhos que começam com `/` | Rodar `export MSYS_NO_PATHCONV=1` antes |
| Importação responde 502 | SKUs da planilha já importados | Subir o ambiente do zero, ou trocar os SKUs da planilha |
| 401 no meio da demo, pela coleção | O token do Keycloak vale 5 minutos | Rodar de novo a requisição do token (a função `bff` do terminal já pede um novo a cada chamada) |
| A lista do BFF não mostra a mudança | Cache de 30 s no Redis ([ADR-0012](../adr/0012-cache-distribuido-no-bff-gateway.md)) | Esperar 30 s, ou consultar o serviço direto (portas 8084, 8086 e 8087) |
| Usuário ou papel novo não aparece no Keycloak | O realm só é importado num volume novo | Subir o ambiente do zero |
| Porta 8080 ou 3000 ocupada | Outro projeto na mesma porta | No Compose, `BFF_PORT=8081 GRAFANA_PORT=3001 make compose-up`, e ajustar `@bff` na coleção. O kind precisa das portas livres |
| Mensagem publicada à mão vai para `catalog.order-stock.dlq` | Valor fora do contrato (ex.: campo `content` em vez de `value` na API do Kafka UI, JSON inválido, `orderId` que não é UUID) | Conferir o valor. O motivo está no header `dlq-reason` da mensagem na DLQ |
