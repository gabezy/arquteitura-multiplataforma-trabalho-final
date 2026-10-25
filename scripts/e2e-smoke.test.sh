#!/usr/bin/env bash
# Scenario tests for scripts/e2e-smoke.sh, derived from .specs/features/e2e-smoke/spec.md.
# Needs the stack up (make compose-up). Each fault is undone right after its run, and again on exit:
# a container cut off the compose network (its own health check keeps passing) or stopped, a
# simulator switched to failure mode, or a WireMock stub that overrides a simulator.
set -uo pipefail
cd "$(dirname "$0")/.."

failures=0
output=''
code=0

e2e() { output=$(env "$@" bash scripts/e2e-smoke.sh 2>&1); code=$?; }
has() { grep -qF -- "$1" <<< "$output"; }
ok_lines() { grep '^\[OK\]' <<< "$output" | tr '\n' '|'; }
run_id() { sed -n 's/^Execucao: //p' <<< "$output"; }
check() {
  if eval "$2"; then
    echo "ok   - $1"
  else
    echo "FAIL - $1"
    printf '%s\n' "$output" | sed 's/^/       /'
    failures=$((failures + 1))
  fi
}
wait_healthy() {
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "FAIL - $1 did not come back healthy" && exit 1
}
network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' catalog-service)
isolate() { docker network disconnect "$network" "$1" > /dev/null; }
reconnect() { docker network connect --alias "$1" "$network" "$1" > /dev/null 2>&1; }

WIREMOCK=http://localhost:8089/__admin
FAKE_BFF_STUBS=(e2e00000-0000-4000-8000-000000000401 e2e00000-0000-4000-8000-000000000200)
PSP_REFUSES_ALL=e2e00000-0000-4000-8000-0000000000f0
PSP_APPROVES_ALL=e2e00000-0000-4000-8000-0000000000f1
stub() { curl -s -o /dev/null -X POST "$WIREMOCK/mappings" -H 'Content-Type: application/json' -d "$1"; }
unstub() { for id in "$@"; do curl -s -o /dev/null -X DELETE "$WIREMOCK/mappings/$id"; done; }
amazon_mode() { curl -s -o /dev/null -X PUT "$WIREMOCK/scenarios/amazon-mode/state" -H 'Content-Type: application/json' -d "{\"state\":\"$1\"}"; }
run_stubs_left() { curl -s "$WIREMOCK/mappings" | grep -c "e2e000[0a-f][ad]-0000-4000-8000-${1: -12}"; }

restore() {
  for app in compliance-service keycloak catalog-service order-service; do reconnect "$app"; done
  docker start order-service > /dev/null 2>&1
  unstub "${FAKE_BFF_STUBS[@]}" "$PSP_REFUSES_ALL" "$PSP_APPROVES_ALL"
  amazon_mode Started
}
trap restore EXIT

# make from the host, or from a throwaway container where make is missing (e.g. Git Bash).
make_out() {
  if command -v make > /dev/null; then
    make "$@"
  else
    MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W 2> /dev/null || pwd):/w" -w /w alpine:3.20 \
      sh -c "apk add -q make > /dev/null 2>&1; make $*"
  fi
}

# E2E-01, E2E-23
check "make e2e generates the .env and runs scripts/e2e-smoke.sh (E2E-01)" \
  '[ "$(make_out -n e2e | tail -1)" = "bash scripts/e2e-smoke.sh" ] && make_out -n e2e | grep -q "sh scripts/generate-env.sh"'
check "make help lists e2e (E2E-23)" 'make_out help | grep -q "e2e.*roda o teste ponta a ponta"'

volumes_before=$(docker volume ls -q | sort)

# E2E-02, E2E-04..E2E-08, E2E-11, E2E-26..E2E-34
e2e E2E_SKIP_UP=0
check "runs docker compose up without E2E_SKIP_UP (E2E-02)" 'has "Subindo o ambiente (docker compose up -d --build)"'
check "passes the nine steps in order and exits 0 (E2E-04..08, E2E-11, E2E-26..34)" \
  '[ "$code" = 0 ] && [ "$(ok_lines)" = "[OK] ambiente|[OK] autenticacao|[OK] importacao|[OK] compliance|[OK] anuncio|[OK] pedido|[OK] confirmacao|[OK] cobranca|[OK] devolucao|" ]'
check "prints the summary of passed and failed steps (E2E-21)" 'has "Resumo: 9 ok, 0 falha(s)"'
check "removes its simulator stubs after a passing run (E2E-35)" '[ "$(run_stubs_left "$(run_id)")" = 0 ]'
first_run=$(run_id)
# docker compose up may recreate a container whose image changed; from here on every run skips it.
containers_before=$(docker ps -aq --no-trunc | sort)

# E2E-03, E2E-15, E2E-16
e2e E2E_SKIP_UP=1
check "skips docker compose up with E2E_SKIP_UP=1 (E2E-03)" '! has "Subindo o ambiente"'
check "second run on the same environment exits 0 (E2E-16)" '[ "$code" = 0 ] && has "[OK] devolucao"'
second_run=$(run_id)
check "each run uses a different run id in the SKUs and order ids (E2E-15)" \
  '[ -n "$first_run" ] && [ "$first_run" != "$second_run" ]'

# E2E-12, E2E-14: compliance cannot reach Kafka, so the products stay PENDING
isolate compliance-service
e2e E2E_SKIP_UP=1
reconnect compliance-service
check "a stuck compliance fails the compliance step with exit 1 (E2E-12)" \
  '[ "$code" = 1 ] && has "[FALHA] compliance: analysisStatus de E2E-"'
check "the timeout prints the last value observed (E2E-14)" "has \"esperado 'APPROVED', ultimo valor 'PENDING' apos 60s\""
check "no step runs after the failed one (E2E-12)" '! has "[OK] anuncio"'

# E2E-13
docker stop order-service > /dev/null
e2e E2E_SKIP_UP=1 E2E_TIMEOUT=5
docker start order-service > /dev/null
check "an unhealthy stack fails the environment step listing the service (E2E-13)" \
  '[ "$code" = 1 ] && has "[FALHA] ambiente: servicos sem healthy apos 5s: order-service=exited"'
check "a failed run still prints the summary (E2E-21)" 'has "Resumo: 0 ok, 1 falha(s)"'
wait_healthy order-service

# E2E-06: the request without a token goes to the catalog, which answers 404 instead of 401
e2e E2E_SKIP_UP=1 BFF_PORT=8082
check "a request without token that is not refused with 401 fails the authentication step (E2E-06)" \
  '[ "$code" = 1 ] && has "[FALHA] autenticacao: importacao sem token respondeu HTTP 404, esperado 401"'

# E2E-25: the client secret comes from BFF_CLIENT_SECRET when it is set, so a wrong one is refused
e2e E2E_SKIP_UP=1 BFF_CLIENT_SECRET=segredo-errado
check "the script uses BFF_CLIENT_SECRET for the token (E2E-25)" \
  '[ "$code" = 1 ] && has "[FALHA] autenticacao: o Keycloak respondeu HTTP 401 sem access_token"'

# Edge case: Keycloak gives no token
isolate keycloak
e2e E2E_SKIP_UP=1
reconnect keycloak
check "no token fails the authentication step with the HTTP status (edge case)" \
  '[ "$code" = 1 ] && has "[FALHA] autenticacao: o Keycloak respondeu HTTP 000 sem access_token"'
# Counted from the output, not timed: how long a refused attempt takes depends on the host's port proxy.
check "the token request is tried 5 times while Keycloak gives no answer (Assumptions: Timeouts)" \
  '[ "$(grep -c "^autenticacao: tentativa [1-4] de 5 sem resposta do Keycloak$" <<< "$output")" = 4 ]'

# Edge case: the import does not answer 200 (the BFF cannot reach the catalog)
isolate catalog-service
e2e E2E_SKIP_UP=1
reconnect catalog-service
check "an import without 200 fails the import step with the status and body (edge case)" \
  '[ "$code" = 1 ] && grep -qE "^\[FALHA\] importacao: HTTP (500: \{.*\"status\":500|000: $)" <<< "$output"'
# The BFF's JVM caches a failed DNS lookup for 10 s.
sleep 15

# E2E-07: a BFF stand-in on WireMock refuses the request without token and imports only 3 products
stub "{\"id\":\"${FAKE_BFF_STUBS[0]}\",\"priority\":1,
  \"request\":{\"method\":\"POST\",\"urlPath\":\"/catalog/import/xlsx\",\"headers\":{\"Authorization\":{\"absent\":true}}},
  \"response\":{\"status\":401}}"
stub "{\"id\":\"${FAKE_BFF_STUBS[1]}\",\"priority\":2,\"request\":{\"method\":\"POST\",\"urlPath\":\"/catalog/import/xlsx\"},
  \"response\":{\"status\":200,\"headers\":{\"Content-Type\":\"application/json\"},\"body\":\"{\\\"importedProducts\\\":3}\"}}"
e2e E2E_SKIP_UP=1 BFF_PORT=8089
unstub "${FAKE_BFF_STUBS[@]}"
check "an import that does not report 4 products fails the import step (E2E-07)" \
  '[ "$code" = 1 ] && has "[FALHA] importacao: HTTP 200: {\"importedProducts\":3}"'

# E2E-27, E2E-35: the order-service cannot be reached, so the order never shows up
isolate order-service
e2e E2E_SKIP_UP=1
reconnect order-service
check "an order that never reaches the order-service fails the order step (E2E-27)" \
  "[ \"\$code\" = 1 ] && grep -qE \"^\\[FALHA\\] pedido: pedido 1[0-9]+ no order-service: esperado '1[0-9]+', ultimo valor '' apos 60s\" <<< \"\$output\""
check "removes its simulator stubs after a failed run (E2E-35)" '[ "$(run_stubs_left "$(run_id)")" = 0 ]'
sleep 15

# E2E-28, E2E-36: 3 units with a stock of 2, so the catalog refuses the reservation
e2e E2E_SKIP_UP=1 E2E_ORDER_QUANTITY=3
check "an order the catalog cannot reserve fails the confirmation step (E2E-28, E2E-36)" \
  "[ \"\$code\" = 1 ] && has \"esperado 'CONFIRMED|PAID', ultimo valor 'CANCELLED' apos 60s\" && has \"[FALHA] confirmacao: status do pedido\""

# E2E-29, E2E-36: 2 units leave a stock of 0, not 1
e2e E2E_SKIP_UP=1 E2E_ORDER_QUANTITY=2
check "a stock that does not end at 1 fails the confirmation step (E2E-29, E2E-36)" \
  "[ \"\$code\" = 1 ] && has \"[FALHA] confirmacao: estoque de E2E-\" && has \"esperado '1', ultimo valor '0' apos 60s\""

# E2E-30: the PSP refuses every charge (a 422 is a refusal for the billing-service)
stub "{\"id\":\"$PSP_REFUSES_ALL\",\"priority\":1,\"request\":{\"method\":\"POST\",\"urlPath\":\"/psp/v1/charges\"},
  \"response\":{\"status\":422,\"headers\":{\"Content-Type\":\"application/json\"},\"body\":\"{\\\"error\\\":\\\"card_declined\\\"}\"}}"
e2e E2E_SKIP_UP=1
unstub "$PSP_REFUSES_ALL"
check "a refused payment of the paid order fails the billing step (E2E-30)" \
  "[ \"\$code\" = 1 ] && has \"[FALHA] cobranca: fatura do pedido\" && has \"esperado 'PAID', ultimo valor 'PAYMENT_FAILED' apos 60s\""

# E2E-32: the PSP approves every charge, including the one above R$ 100.000
stub "$(cat <<'EOF'
{"id":"e2e00000-0000-4000-8000-0000000000f1","priority":1,
 "request":{"method":"POST","urlPath":"/psp/v1/charges"},
 "response":{"status":201,"headers":{"Content-Type":"application/json"},"transformers":["response-template"],
  "jsonBody":{"id":"ch_paid_{{jsonPath request.body '$.reference'}}","reference":"{{jsonPath request.body '$.reference'}}","status":"PENDING"}},
 "serveEventListeners":[{"name":"webhook","parameters":{"method":"POST","url":"{{jsonPath originalRequest.body '$.callbackUrl'}}",
  "headers":{"Content-Type":"application/json","X-PSP-Token":"psp-demo-token"},"delay":{"type":"fixed","milliseconds":2000},
  "body":"{ \"chargeId\": \"ch_paid_{{jsonPath originalRequest.body '$.reference'}}\", \"reference\": \"{{jsonPath originalRequest.body '$.reference'}}\", \"status\": \"PAID\", \"failureReason\": null, \"occurredAt\": \"{{now format='yyyy-MM-dd\\'T\\'HH:mm:ss\\'Z\\''}}\" }"}}]}
EOF
)"
e2e E2E_SKIP_UP=1
unstub "$PSP_APPROVES_ALL"
check "an approved payment of the expensive order fails the refused-payment step (E2E-32)" \
  "[ \"\$code\" = 1 ] && has \"[FALHA] devolucao: fatura do pedido\" && has \"esperado 'PAYMENT_FAILED', ultimo valor 'PAID' apos 60s\""

# E2E-26: the Amazon simulator answers 503, so the listing there ends FAILED
amazon_mode UNAVAILABLE
e2e E2E_SKIP_UP=1
amazon_mode Started
check "a listing that is not published in every marketplace fails the listing step (E2E-26)" \
  "[ \"\$code\" = 1 ] && has \"[FALHA] anuncio: anuncios PUBLISHED de E2E-\" && has \"esperado '3', ultimo valor '2' apos 60s\""
# The gateway's circuit breaker stays open for 30 s after the failed calls.
sleep 35

# The environment works again once every fault is undone
e2e E2E_SKIP_UP=1
check "a normal run passes after the faults are restored" '[ "$code" = 0 ]'

# E2E-17
check "no volume was deleted (E2E-17)" '[ "$volumes_before" = "$(docker volume ls -q | sort)" ]'
check "no container was deleted or recreated by the runs that skip docker compose up (E2E-17)" \
  '[ "$containers_before" = "$(docker ps -aq --no-trunc | sort)" ]'

echo "$failures failure(s)"
[ "$failures" = 0 ]
