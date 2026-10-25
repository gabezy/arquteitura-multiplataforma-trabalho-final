#!/usr/bin/env bash
# End-to-end smoke test of the omni-market flow (#37, spec in .specs/features/e2e-smoke/spec.md).
#
#   make e2e                      # or: bash scripts/e2e-smoke.sh
#   E2E_SKIP_UP=1                 # do not run docker compose up (stack already running)
#   E2E_TIMEOUT=300               # seconds to wait for the stack to be healthy
#   BFF_PORT=8080                 # same variable as the compose file
#   BFF_CLIENT_SECRET=...         # default: read from .env, which make env generates
#   E2E_ORDER_QUANTITY=1          # units of the paid order (a test hook for the harness)
#
# Needs bash, curl and Docker. It never deletes containers, volumes or data.
set -uo pipefail
cd "$(dirname "$0")/.."

BFF="http://localhost:${BFF_PORT:-8080}"
CATALOG=http://localhost:8082
KEYCLOAK=http://localhost:8085/realms/omni-market/protocol/openid-connect/token
WIREMOCK=http://localhost:8089/__admin/mappings
STACK_TIMEOUT=${E2E_TIMEOUT:-300}
STEP_TIMEOUT=60
APPS=(keycloak bff-gateway catalog-service compliance-service order-service billing-service marketplace-gateway)
# Always 15 digits (10 of the epoch, 5 of $RANDOM), so the slices below are never short.
RUN="$(date +%s)$(printf '%05d' "$RANDOM")"
CHEAP="E2E-$RUN-A"
PROHIBITED_TERM="E2E-$RUN-B"
ABOVE_CEILING="E2E-$RUN-C"
EXPENSIVE="E2E-$RUN-D"
QUANTITY=${E2E_ORDER_QUANTITY:-1}
# Mercado Livre order ids are numbers; the stub ids are UUIDs. Both carry the run id, used as text
# (printf %d would read a leading zero as octal).
PAID_ORDER="1${RUN: -12}"
REFUSED_ORDER="2${RUN: -12}"
PAID_STUB="e2e0000a-0000-4000-8000-${RUN: -12}"
REFUSED_STUB="e2e0000d-0000-4000-8000-${RUN: -12}"

tmp=$(mktemp -d)
cleanup() {
  for stub in "$PAID_STUB" "$REFUSED_STUB"; do curl -s -o /dev/null --max-time 5 -X DELETE "$WIREMOCK/$stub"; done
  rm -rf "$tmp"
}
trap cleanup EXIT

passed=0
failed=0

ok() { echo "[OK] $1"; passed=$((passed + 1)); }
summary() { echo "Resumo: $passed ok, $failed falha(s)"; }
fail() {
  echo "[FALHA] $1: $2"
  failed=$((failed + 1))
  summary
  exit 1
}

# wait_for <step> <what> <expected> <command...>: polls the command until it prints the expected value.
# The expected value may list alternatives separated by "|".
wait_for() {
  local step=$1 what=$2 expected=$3 value deadline=$((SECONDS + STEP_TIMEOUT))
  shift 3
  while :; do
    value=$("$@")
    [[ "|$expected|" == *"|$value|"* ]] && [ -n "$value" ] && return 0
    [ "$SECONDS" -ge "$deadline" ] && fail "$step" "$what: esperado '$expected', ultimo valor '$value' apos ${STEP_TIMEOUT}s"
    sleep 1
  done
}

product_field() { curl -s --max-time 10 "$CATALOG/products/sku/$1" | sed -nE "s/.*\"$2\":\"?([^\",}]*).*/\1/p"; }
bff_get() { curl -s --max-time 10 -H "Authorization: Bearer $token" "$BFF$1"; }
published_listings() { bff_get "/listings?sku=$1" | grep -o '"status":"PUBLISHED"' | wc -l | tr -d ' '; }
# order_field <externalOrderId> <field>: one order per line, starting at its id.
order_field() {
  bff_get "/orders?marketplace=MERCADO_LIVRE&limit=100" | sed 's/{"id":"/\n{"id":"/g' \
    | grep "\"externalOrderId\":\"$1\"" | sed -nE "s/.*\"$2\":\"?([^\",}]*).*/\1/p" | head -1
}
order_outcome() { echo "$(order_field "$1" status)/$(order_field "$1" cancellationReason)"; }
invoice_status() { bff_get "/invoices?orderId=$1" | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4; }

# register_order <stub id> <order id> <sku> <quantity> <unit price>: an order in the Mercado Livre
# simulator. The marketplace-gateway finds it on its next poll (every 5 s).
register_order() {
  local total
  total=$(awk -v q="$4" -v p="$5" 'BEGIN { printf "%.2f", q * p }')
  curl -s --max-time 10 -o /dev/null -w '%{http_code}' -X POST "$WIREMOCK" -H 'Content-Type: application/json' -d "{
    \"id\": \"$1\", \"priority\": 1, \"persistent\": false,
    \"request\": { \"method\": \"GET\", \"urlPath\": \"/mercadolivre/orders/search\" },
    \"response\": { \"status\": 200, \"headers\": { \"Content-Type\": \"application/json\" }, \"jsonBody\": {
      \"results\": [{ \"id\": $2, \"status\": \"paid\", \"date_created\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
        \"total_amount\": $total, \"currency_id\": \"BRL\",
        \"order_items\": [{ \"item\": { \"id\": \"MLB1000000001\", \"seller_custom_field\": \"$3\" },
          \"quantity\": $4, \"unit_price\": $5 }] }],
      \"paging\": { \"total\": 1, \"offset\": 0, \"limit\": 50 } } } }"
}

unhealthy_apps() {
  local app status
  for app in "${APPS[@]}"; do
    status=$(docker inspect -f '{{if ne .State.Status "running"}}{{.State.Status}}{{else if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$app" 2>/dev/null) || status=ausente
    [ "$status" = healthy ] || printf '%s=%s ' "$app" "$status"
  done
}

echo "Execucao: $RUN"

if [ "${E2E_SKIP_UP:-}" != 1 ]; then
  echo "Subindo o ambiente (docker compose up -d --build)"
  # The compose file refuses to start without the secrets in .env; this keeps the existing ones.
  sh scripts/generate-env.sh > "$tmp/env.log" 2>&1 || fail ambiente "nao foi possivel gerar o .env: $(tail -3 "$tmp/env.log")"
  docker compose up -d --build > "$tmp/up.log" 2>&1 || fail ambiente "docker compose up falhou: $(tail -5 "$tmp/up.log")"
fi
deadline=$((SECONDS + STACK_TIMEOUT))
until [ -z "$(unhealthy_apps)" ]; do
  [ "$SECONDS" -ge "$deadline" ] && fail ambiente "servicos sem healthy apos ${STACK_TIMEOUT}s: $(unhealthy_apps)"
  sleep 5
done
ok ambiente

# The client secret is generated into .env (Vault, ADR-0003); the variable wins when it is set.
CLIENT_SECRET=${BFF_CLIENT_SECRET:-$(sed -n 's/^BFF_CLIENT_SECRET=//p' .env 2> /dev/null | tr -d '\r')}
[ -n "$CLIENT_SECRET" ] || fail autenticacao "BFF_CLIENT_SECRET ausente no ambiente e no .env (rode make env)"
# A few attempts: a token request now and then gets no answer from a busy Keycloak.
for attempt in 1 2 3 4 5; do
  status=$(curl -s --max-time 10 -o "$tmp/token.json" -w '%{http_code}' -X POST "$KEYCLOAK" \
    -d grant_type=password -d client_id=bff-gateway -d client_secret="$CLIENT_SECRET" \
    -d username=admin -d password=admin)
  token=$(sed -nE 's/.*"access_token":"([^"]+)".*/\1/p' "$tmp/token.json" 2> /dev/null)
  [ -n "$token" ] || [ "$status" != 000 ] && break
  sleep 2
done
[ -n "$token" ] || fail autenticacao "o Keycloak respondeu HTTP $status sem access_token"
status=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' -F file=sem-token "$BFF/catalog/import/xlsx")
[ "$status" = 401 ] || fail autenticacao "importacao sem token respondeu HTTP $status, esperado 401"
ok autenticacao

docker run --rm -i python:3.13-alpine python - "$RUN" < scripts/e2e-catalog-xlsx.py \
  > "$tmp/catalog.xlsx" 2> "$tmp/xlsx.log" && [ -s "$tmp/catalog.xlsx" ] \
  || fail importacao "nao foi possivel gerar a planilha: $(tail -3 "$tmp/xlsx.log")"
status=$(curl -s --max-time 30 -o "$tmp/import.json" -w '%{http_code}' -H "Authorization: Bearer $token" \
  -F "file=@$tmp/catalog.xlsx" "$BFF/catalog/import/xlsx")
[ "$status" = 200 ] && grep -qE '"importedProducts":4[,}]' "$tmp/import.json" \
  || fail importacao "HTTP $status: $(cat "$tmp/import.json" 2> /dev/null)"
ok importacao

wait_for compliance "analysisStatus de $CHEAP" APPROVED product_field "$CHEAP" analysisStatus
wait_for compliance "analysisStatus de $EXPENSIVE" APPROVED product_field "$EXPENSIVE" analysisStatus
wait_for compliance "analysisStatus de $PROHIBITED_TERM" REJECTED product_field "$PROHIBITED_TERM" analysisStatus
wait_for compliance "analysisStatus de $ABOVE_CEILING" REJECTED product_field "$ABOVE_CEILING" analysisStatus
ok compliance

wait_for anuncio "anuncios PUBLISHED de $CHEAP" 3 published_listings "$CHEAP"
ok anuncio

status=$(register_order "$PAID_STUB" "$PAID_ORDER" "$CHEAP" "$QUANTITY" 59.9)
[ "$status" = 201 ] || fail pedido "o simulador do Mercado Livre respondeu HTTP $status ao registrar o pedido"
wait_for pedido "pedido $PAID_ORDER no order-service" "$PAID_ORDER" order_field "$PAID_ORDER" externalOrderId
ok pedido

wait_for confirmacao "status do pedido $PAID_ORDER" "CONFIRMED|PAID" order_field "$PAID_ORDER" status
wait_for confirmacao "estoque de $CHEAP" 1 product_field "$CHEAP" stock
ok confirmacao

order_id=$(order_field "$PAID_ORDER" id)
wait_for cobranca "fatura do pedido $PAID_ORDER" PAID invoice_status "$order_id"
wait_for cobranca "status do pedido $PAID_ORDER" PAID order_field "$PAID_ORDER" status
ok cobranca

# 2 units of R$ 60.000: the PSP simulator refuses a charge of R$ 100.000 or more.
status=$(register_order "$REFUSED_STUB" "$REFUSED_ORDER" "$EXPENSIVE" 2 60000)
[ "$status" = 201 ] || fail devolucao "o simulador do Mercado Livre respondeu HTTP $status ao registrar o pedido"
wait_for devolucao "pedido $REFUSED_ORDER no order-service" "$REFUSED_ORDER" order_field "$REFUSED_ORDER" externalOrderId
refused_id=$(order_field "$REFUSED_ORDER" id)
wait_for devolucao "fatura do pedido $REFUSED_ORDER" PAYMENT_FAILED invoice_status "$refused_id"
wait_for devolucao "status do pedido $REFUSED_ORDER" CANCELLED/PAYMENT_FAILED order_outcome "$REFUSED_ORDER"
wait_for devolucao "estoque de $EXPENSIVE" 2 product_field "$EXPENSIVE" stock
ok devolucao

summary
