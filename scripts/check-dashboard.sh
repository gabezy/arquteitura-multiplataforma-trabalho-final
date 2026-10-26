#!/usr/bin/env bash
# Smoke test do dashboard "Omni Market - Serviços" contra um ambiente já de pé (make compose-up
# ou make k8s-deploy: os dois expõem Grafana, BFF, Keycloak e WireMock nas mesmas portas).
#
# Gera tráfego pelo BFF (respostas 2xx, 4xx e um pedido simulado que passa pelo Kafka), espera as
# métricas chegarem e verifica pela API do Grafana:
#   - o dashboard e os datasources provisionados;
#   - cada consulta de cada painel, como o Grafana a executa, com dados;
#   - as arestas HTTP e Kafka do service graph, a normalização dos atributos HTTP e as métricas de
#     hardware dos seis serviços;
#   - a ordem das colunas das tabelas.
#
# Precisa de curl e jq. Sai com código 1 se alguma verificação falhar.
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:${GRAFANA_PORT:-3000}}"
GRAFANA_AUTH="${GRAFANA_AUTH:-admin:admin}"
BFF_URL="${BFF_URL:-http://localhost:${BFF_PORT:-8080}}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8085}"
DASHBOARD_NAME="omni-market-overview"
APPS=(bff-gateway catalog-service compliance-service order-service billing-service marketplace-gateway)
# Segundos de espera pelas métricas: flush dos connectors (15 s) + scrape do Prometheus (15 s) + folga.
WAIT_SECONDS="${WAIT_SECONDS:-120}"
# Painéis que podem ficar sem dados num ambiente saudável: falhas só aparecem com falhas, e no kind
# (containerd) não há métricas de disco por container.
ALLOW_EMPTY="${ALLOW_EMPTY:-Falhas por segundo entre serviços|Disco (leitura + / escrita −)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failures=0

command -v jq > /dev/null || { echo "Precisa do jq instalado." >&2; exit 1; }

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFALHA\033[0m %s\n' "$1"; failures=$((failures + 1)); }
section() { printf '\n%s\n' "$1"; }

grafana() {
  curl -sS -u "$GRAFANA_AUTH" -H 'Content-Type: application/json' "$@"
}

# Executa consultas como o painel faz: POST /api/ds/query nos últimos 15 minutos.
ds_query() {
  local now
  now="$(date +%s)"
  grafana -X POST "$GRAFANA_URL/api/ds/query" \
    -d "$(jq -nc --argjson queries "$1" --arg from "$(((now - 900) * 1000))" --arg to "$((now * 1000))" \
      '{queries: $queries, from: $from, to: $to}')"
}

prom_query() {
  ds_query "$(jq -nc --arg expr "$1" \
    '[{refId: "A", datasource: {type: "prometheus", uid: "Prometheus"}, expr: $expr, instant: true, range: false}]')"
}

# Número de linhas devolvidas por uma consulta Prometheus instantânea.
prom_count() {
  prom_query "$1" | jq '[.results.A.frames[]? | .data.values[-1] // [] | length] | add // 0'
}

# ---------------------------------------------------------------- pré-requisitos
section "Ambiente"
curl -fsS -o /dev/null "$GRAFANA_URL/api/health" || { echo "Grafana fora do ar em $GRAFANA_URL" >&2; exit 1; }
pass "Grafana em $GRAFANA_URL"

if [[ -z "${BFF_CLIENT_SECRET:-}" && -f "$ROOT/.env" ]]; then
  BFF_CLIENT_SECRET="$(sed -n 's/^BFF_CLIENT_SECRET=//p' "$ROOT/.env")"
fi
[[ -n "${BFF_CLIENT_SECRET:-}" ]] || { echo "BFF_CLIENT_SECRET não definido (nem no .env)." >&2; exit 1; }

# ---------------------------------------------------------------- provisionamento
section "Provisionamento"
# O arquivo está no formato v2 (dashboard.grafana.app/v2), lido aqui pela mesma API.
dashboard="$(grafana "$GRAFANA_URL/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/$DASHBOARD_NAME")"
if jq -e '.kind == "Dashboard"' <<< "$dashboard" > /dev/null; then
  pass "dashboard $(jq -r '.spec.title' <<< "$dashboard")"
else
  fail "dashboard $DASHBOARD_NAME não provisionado"
  exit 1
fi
folder_uid="$(jq -r '.metadata.annotations["grafana.app/folder"] // empty' <<< "$dashboard")"
folder="$(grafana "$GRAFANA_URL/api/folders/$folder_uid" | jq -r '.title // "nenhuma"')"
[[ "$folder" == "Omni Market" ]] && pass "pasta Omni Market" || fail "pasta: esperada Omni Market, veio $folder"

for uid in Prometheus Loki Tempo; do
  status="$(grafana "$GRAFANA_URL/api/datasources/uid/$uid/health" | jq -r '.status // "ausente"')"
  [[ "$status" == "OK" ]] && pass "datasource $uid" || fail "datasource $uid: $status"
done

# ---------------------------------------------------------------- tráfego
section "Tráfego"
token="$(curl -fsS -X POST "$KEYCLOAK_URL/realms/omni-market/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=bff-gateway -d client_secret="$BFF_CLIENT_SECRET" \
  -d username=admin -d password=admin | jq -r .access_token)"
paths=(
  /orders /invoices /listings
  "/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31"
  /orders/6f1c2b8e-0000-4000-8000-0000000000ff        # 404
  "/reports/sales-by-marketplace?from=2026-10-31&to=2026-10-01"  # 400
)
for _ in $(seq 1 15); do
  for path in "${paths[@]}"; do
    curl -s -o /dev/null -H "Authorization: Bearer $token" "$BFF_URL$path"
  done
done
pass "$((15 * ${#paths[@]})) requisições ao BFF (2xx, 404 e 400)"
"$ROOT/scripts/simulate-order.sh" amazon --qty 1 > /dev/null
pass "pedido simulado na Amazon (marketplace-gateway → Kafka → order-service)"

# ---------------------------------------------------------------- espera
section "Métricas (até ${WAIT_SECONDS}s)"
wait_for() {
  local description="$1" expr="$2" deadline=$((SECONDS + WAIT_SECONDS))
  until [[ "$(prom_count "$expr")" -gt 0 ]]; do
    if ((SECONDS >= deadline)); then
      fail "$description"
      return
    fi
    sleep 5
  done
  pass "$description"
}
wait_for "span metrics do BFF" \
  'sum(rate(traces_span_metrics_calls_total{service_name="bff-gateway", span_kind="SPAN_KIND_SERVER"}[2m])) > 0'
wait_for "aresta HTTP bff-gateway → order-service" \
  'sum(rate(traces_service_graph_request_total{client="bff-gateway", server="order-service"}[2m])) > 0'
wait_for "aresta Kafka marketplace-gateway → order-service" \
  'traces_service_graph_request_total{client="marketplace-gateway", server="order-service", connection_type="messaging_system"}'
wait_for "status HTTP normalizado no Spring (404 no BFF)" \
  'traces_span_metrics_calls_total{service_name="bff-gateway", span_kind="SPAN_KIND_SERVER", http_response_status_code="404"}'
wait_for "status HTTP normalizado no FastAPI (compliance-service)" \
  'traces_span_metrics_calls_total{service_name="compliance-service", http_response_status_code=~"[0-9]{3}"}'

for app in "${APPS[@]}"; do
  [[ "$(prom_count "container_memory_working_set_bytes{service=\"$app\"}")" -gt 0 ]] \
    && pass "hardware de $app" || fail "sem container_memory_working_set_bytes{service=\"$app\"}"
done

# ---------------------------------------------------------------- painéis
section "Consultas dos painéis"
all_apps="$(jq -r '.spec.variables[] | select(.spec.name == "service") | .spec.allValue' <<< "$dashboard")"
# Uma linha por consulta: título do painel e a query no formato de /api/ds/query, com as variáveis
# do Grafana trocadas pelos valores que o painel usaria ($service = All).
queries="$(jq -c --arg apps "$all_apps" '
  .spec.elements[].spec | .title as $title | .data.spec.queries[].spec | .refId as $ref | .query |
  {title: $title, query: (.spec + {
    refId: $ref,
    datasource: {type: .group, uid: .datasource.name},
    expr: (.spec.expr | gsub("\\$__rate_interval"; "2m") | gsub("\\$__range"; "15m") | gsub("\\$__auto"; "1m")
                      | gsub("\\$service"; $apps)),
    instant: (if .group == "prometheus" then true else .spec.instant end),
    range: (if .group == "prometheus" then false else .spec.range end)
  })}' <<< "$dashboard")"

while IFS= read -r item; do
  title="$(jq -r .title <<< "$item")"
  ref="$(jq -r .query.refId <<< "$item")"
  result="$(ds_query "$(jq -c '[.query]' <<< "$item")")"
  error="$(jq -r --arg ref "$ref" '.results[$ref].error // empty' <<< "$result")"
  rows="$(jq --arg ref "$ref" '[.results[$ref].frames[]? | .data.values[-1] // [] | length] | add // 0' <<< "$result")"
  if [[ -n "$error" ]]; then
    fail "$title ($ref): $error"
  elif ((rows > 0)); then
    pass "$title ($ref): $rows linhas"
  elif [[ "|$ALLOW_EMPTY|" == *"|$title|"* ]]; then
    pass "$title ($ref): sem dados (permitido)"
  else
    fail "$title ($ref): sem dados"
  fi
done <<< "$queries"

# ---------------------------------------------------------------- colunas
section "Ordem das colunas"
check_columns() {
  local title="$1" expected="$2" got
  got="$(jq -r --arg title "$title" '
    .spec.elements[].spec | select(.title == $title) | .data.spec.transformations[] | select(.group == "organize") |
    .spec.options as $o |
    $o.indexByName | to_entries | sort_by(.value) | map($o.renameByName[.key] // .key) | .[0:3] | join(", ")' <<< "$dashboard")"
  [[ "$got" == "$expected" ]] && pass "$title: $got" || fail "$title: esperado [$expected], veio [$got]"
}
check_columns "Resumo por serviço" "Serviço, Memória, CPU (cores)"
check_columns "Chamadas entre serviços" "Origem, Tipo, Destino"
check_columns "Operações (rotas HTTP e tópicos consumidos)" "Serviço, Tipo, Operação"

echo
if ((failures > 0)); then
  echo "$failures verificação(ões) falharam."
  exit 1
fi
echo "Dashboard OK."
