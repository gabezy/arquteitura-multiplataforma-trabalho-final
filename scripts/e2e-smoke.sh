#!/usr/bin/env bash
# End-to-end smoke test of the omni-market flow (#37, spec in .specs/features/e2e-smoke/spec.md).
#
#   make e2e                      # or: bash scripts/e2e-smoke.sh
#   E2E_SKIP_UP=1                 # do not run docker compose up (stack already running)
#   E2E_STRICT=1                  # pending steps fail the run (final delivery)
#   E2E_TIMEOUT=300               # seconds to wait for the stack to be healthy
#   BFF_PORT=8080                 # same variable as the compose file
#
# Needs bash, curl and Docker. It never deletes containers, volumes or data.
set -uo pipefail
cd "$(dirname "$0")/.."

BFF="http://localhost:${BFF_PORT:-8080}"
CATALOG=http://localhost:8082
KEYCLOAK=http://localhost:8085/realms/omni-market/protocol/openid-connect/token
STACK_TIMEOUT=${E2E_TIMEOUT:-300}
STEP_TIMEOUT=60
APPS=(keycloak bff-gateway catalog-service compliance-service order-service)
RUN="$(date +%s)$RANDOM"
APPROVED="E2E-$RUN-A"
PROHIBITED_TERM="E2E-$RUN-B"
ABOVE_CEILING="E2E-$RUN-C"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

passed=0
failed=0
pending=0

ok() { echo "[OK] $1"; passed=$((passed + 1)); }
pending() { echo "[PENDENTE] $1"; pending=$((pending + 1)); }
summary() { echo "Resumo: $passed ok, $failed falha(s), $pending pendente(s)"; }
fail() {
  echo "[FALHA] $1: $2"
  failed=$((failed + 1))
  summary
  exit 1
}

# wait_for <step> <what> <expected> <command...>: polls the command until it prints the expected value.
wait_for() {
  local step=$1 what=$2 expected=$3 value deadline=$((SECONDS + STEP_TIMEOUT))
  shift 3
  while :; do
    value=$("$@")
    [ "$value" = "$expected" ] && return 0
    [ "$SECONDS" -ge "$deadline" ] && fail "$step" "$what: esperado '$expected', ultimo valor '$value' apos ${STEP_TIMEOUT}s"
    sleep 1
  done
}

product_field() { curl -s --max-time 10 "$CATALOG/products/sku/$1" | sed -nE "s/.*\"$2\":\"?([^\",}]*).*/\1/p"; }

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
  docker compose up -d --build > "$tmp/up.log" 2>&1 || fail ambiente "docker compose up falhou: $(tail -5 "$tmp/up.log")"
fi
deadline=$((SECONDS + STACK_TIMEOUT))
until [ -z "$(unhealthy_apps)" ]; do
  [ "$SECONDS" -ge "$deadline" ] && fail ambiente "servicos sem healthy apos ${STACK_TIMEOUT}s: $(unhealthy_apps)"
  sleep 5
done
ok ambiente

status=$(curl -s --max-time 10 -o "$tmp/token.json" -w '%{http_code}' -X POST "$KEYCLOAK" \
  -d grant_type=password -d client_id=bff-gateway -d client_secret=bff-gateway-secret \
  -d username=admin -d password=admin)
token=$(sed -nE 's/.*"access_token":"([^"]+)".*/\1/p' "$tmp/token.json")
[ -n "$token" ] || fail autenticacao "o Keycloak respondeu HTTP $status sem access_token"
status=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' -F file=sem-token "$BFF/catalog/import/xlsx")
[ "$status" = 401 ] || fail autenticacao "importacao sem token respondeu HTTP $status, esperado 401"
ok autenticacao

docker run --rm -i python:3.13-alpine python - "$RUN" < scripts/e2e-catalog-xlsx.py \
  > "$tmp/catalog.xlsx" 2> "$tmp/xlsx.log" && [ -s "$tmp/catalog.xlsx" ] \
  || fail importacao "nao foi possivel gerar a planilha: $(tail -3 "$tmp/xlsx.log")"
status=$(curl -s --max-time 30 -o "$tmp/import.json" -w '%{http_code}' -H "Authorization: Bearer $token" \
  -F "file=@$tmp/catalog.xlsx" "$BFF/catalog/import/xlsx")
[ "$status" = 200 ] && grep -q '"importedProducts":3' "$tmp/import.json" \
  || fail importacao "HTTP $status: $(cat "$tmp/import.json")"
ok importacao

wait_for compliance "analysisStatus de $APPROVED" APPROVED product_field "$APPROVED" analysisStatus
wait_for compliance "analysisStatus de $PROHIBITED_TERM" REJECTED product_field "$PROHIBITED_TERM" analysisStatus
wait_for compliance "analysisStatus de $ABOVE_CEILING" REJECTED product_field "$ABOVE_CEILING" analysisStatus
ok compliance

summary
