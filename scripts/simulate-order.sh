#!/usr/bin/env bash
# Registra um pedido simulado nos marketplaces do WireMock, no formato próprio de cada um.
# O marketplace-gateway acha o pedido na próxima consulta (polling) e o publica no Kafka.
#
# O pedido vai para um stub dinâmico do WireMock, só em memória: `--clear`, o restart do
# WireMock ou `curl -X POST $WIREMOCK_URL/__admin/mappings/reset` apagam todos.
#
# O WireMock fica em WIREMOCK_URL (padrão http://localhost:8089). Precisa de curl e jq.
set -euo pipefail

WIREMOCK_URL="${WIREMOCK_URL:-http://localhost:8089}"
MARKETPLACES=(amazon mercadolivre shopee)

usage() {
  cat >&2 <<EOF
Uso: scripts/simulate-order.sh <amazon|mercadolivre|shopee|all> [opções]
     scripts/simulate-order.sh <amazon|mercadolivre|shopee|all> --clear

Opções:
  --sku SKU       SKU do produto (padrão NB-001)
  --qty N         quantidade (padrão 1)
  --price PREÇO   preço unitário em reais (padrão 4500.00)
  --id ID         id do pedido no marketplace (padrão: gerado). Repetir o id não cria outro pedido no Kafka
  --clear         remove os pedidos simulados
EOF
  exit 1
}

command -v jq > /dev/null || { echo "Precisa do jq instalado." >&2; exit 1; }

[ $# -ge 1 ] || usage
case "$1" in
  all) targets=("${MARKETPLACES[@]}") ;;
  amazon | mercadolivre | shopee) targets=("$1") ;;
  *) usage ;;
esac
shift

sku=NB-001
qty=1
price=4500.00
external_id=""
clear=false
while [ $# -gt 0 ]; do
  case "$1" in
    --sku) sku="${2:?--sku pede um valor}"; shift 2 ;;
    --qty) qty="${2:?--qty pede um valor}"; shift 2 ;;
    --price) price="${2:?--price pede um valor}"; shift 2 ;;
    --id) external_id="${2:?--id pede um valor}"; shift 2 ;;
    --clear) clear=true; shift ;;
    *) usage ;;
  esac
done

[[ "$qty" =~ ^[1-9][0-9]*$ ]] || { echo "--qty precisa ser um inteiro maior que zero." >&2; exit 1; }
[[ "$price" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "--price precisa ser um número, como 4500.00." >&2; exit 1; }

total=$(awk -v q="$qty" -v p="$price" 'BEGIN { printf "%.2f", q * p }')
random_digits() { printf "%0${1}d" $(( (RANDOM * 32768 + RANDOM) % 10 ** $1 )); }

stub_id() {
  case "$1" in
    amazon) echo "aa000000-0000-4000-8000-0000000000d1" ;;
    mercadolivre) echo "bb000000-0000-4000-8000-0000000000d1" ;;
    shopee) echo "cc000000-0000-4000-8000-0000000000d1" ;;
  esac
}

orders_path() {
  case "$1" in
    amazon) echo "/amazon/orders/v0/orders" ;;
    mercadolivre) echo "/mercadolivre/orders/search" ;;
    shopee) echo "/shopee/api/v2/order/get_order_list" ;;
  esac
}

# Os pedidos que o stub dinâmico devolve hoje, ou [] se ele ainda não existe.
current_orders() {
  local existing="$1" marketplace="$2" filter
  case "$marketplace" in
    amazon) filter='.response.jsonBody.payload.Orders' ;;
    mercadolivre) filter='.response.jsonBody.results' ;;
    shopee) filter='.response.jsonBody.response.order_list' ;;
  esac
  if [ -n "$existing" ]; then jq -c "$filter" <<< "$existing"; else echo '[]'; fi
}

new_order() {
  case "$1" in
    amazon)
      local id="${external_id:-701-$(random_digits 7)-$(random_digits 7)}"
      jq -nc --arg id "$id" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sku "$sku" --argjson qty "$qty" --arg total "$total" '
        { AmazonOrderId: $id, PurchaseDate: $date, OrderStatus: "Unshipped",
          OrderTotal: { CurrencyCode: "BRL", Amount: $total },
          OrderItems: [{ SellerSKU: $sku, QuantityOrdered: $qty, ItemPrice: { CurrencyCode: "BRL", Amount: $total } }] }'
      ;;
    mercadolivre)
      local id="${external_id:-2$(random_digits 9)}"
      jq -nc --arg id "$id" --arg date "$(TZ=America/Sao_Paulo date +%Y-%m-%dT%H:%M:%S.000-03:00)" --arg sku "$sku" --argjson qty "$qty" --argjson price "$price" --argjson total "$total" '
        { id: (if ($id | test("^[0-9]+$")) then ($id | tonumber) else $id end),
          status: "paid", date_created: $date, total_amount: $total, currency_id: "BRL",
          order_items: [{ item: { id: "MLB1000000001", seller_custom_field: $sku }, quantity: $qty, unit_price: $price }] }'
      ;;
    shopee)
      local id="${external_id:-SHP$(date +%y%m%d)$(printf '%06X' $(( (RANDOM * 32768 + RANDOM) % 16777216 )))}"
      jq -nc --arg id "$id" --argjson created "$(date +%s)" --arg sku "$sku" --argjson qty "$qty" --argjson price "$price" --argjson total "$total" '
        { order_sn: $id, order_status: "READY_TO_SHIP", create_time: $created, total_amount: $total,
          item_list: [{ item_sku: $sku, model_quantity_purchased: $qty, model_discounted_price: $price }] }'
      ;;
  esac
}

stub_with_orders() {
  local marketplace="$1" orders="$2"
  jq -nc --arg stubId "$(stub_id "$marketplace")" --arg path "$(orders_path "$marketplace")" --arg marketplace "$marketplace" --argjson orders "$orders" '
    ( if $marketplace == "amazon" then { payload: { Orders: $orders, NextToken: null } }
      elif $marketplace == "mercadolivre" then { results: $orders, paging: { total: ($orders | length), offset: 0, limit: 50 } }
      else { error: "", message: "", request_id: "simulated", response: { more: false, next_cursor: "", order_list: $orders } } end
    ) as $body
    | { id: $stubId, name: ($marketplace + ": pedidos simulados"), priority: 2, persistent: false,
        request: { method: "GET", urlPath: $path },
        response: { status: 200, headers: { "Content-Type": "application/json" }, jsonBody: $body } }'
}

# Chama a API admin do WireMock e falha, mostrando a resposta, se o status for 400 ou mais.
admin() { # admin <método> <caminho> [corpo]
  local response status
  response="$(curl -sS -X "$1" "$WIREMOCK_URL$2" -H 'Content-Type: application/json' ${3:+-d "$3"} -w '\n%{http_code}')"
  status="${response##*$'\n'}"
  if [ "$status" -ge 400 ]; then
    printf '%s\n' "${response%$'\n'*}" >&2
    return 1
  fi
}

curl -fsS -o /dev/null "$WIREMOCK_URL/__admin/mappings" 2> /dev/null || {
  echo "Não consegui falar com o WireMock em $WIREMOCK_URL (make up-infra sobe o WireMock)." >&2
  exit 1
}

for marketplace in "${targets[@]}"; do
  id="$(stub_id "$marketplace")"
  existing="$(curl -sS "$WIREMOCK_URL/__admin/mappings/$id")"
  jq -e --arg id "$id" '.id == $id' <<< "$existing" > /dev/null 2>&1 || existing=""

  if $clear; then
    [ -z "$existing" ] || admin DELETE "/__admin/mappings/$id"
    echo "$marketplace: pedidos simulados removidos"
    continue
  fi

  order="$(new_order "$marketplace")"
  orders="$(jq -c --argjson order "$order" '. + [$order]' <<< "$(current_orders "$existing" "$marketplace")")"
  stub="$(stub_with_orders "$marketplace" "$orders")"

  if [ -n "$existing" ]; then
    admin PUT "/__admin/mappings/$id" "$stub"
  else
    admin POST "/__admin/mappings" "$stub"
  fi

  echo "$marketplace: pedido $(jq -r '.AmazonOrderId // .id // .order_sn' <<< "$order") ($qty x $sku, total R\$ $total)"
done
