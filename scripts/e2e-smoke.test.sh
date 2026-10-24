#!/usr/bin/env bash
# Scenario tests for scripts/e2e-smoke.sh, derived from .specs/features/e2e-smoke/spec.md.
# Needs the stack up (make up). Cuts one container at a time off the compose network (its own
# health check keeps passing) or stops it, and restores it afterwards.
set -uo pipefail
cd "$(dirname "$0")/.."

failures=0
output=''
code=0

e2e() { output=$(env "$@" bash scripts/e2e-smoke.sh 2>&1); code=$?; }
has() { grep -qF -- "$1" <<< "$output"; }
ok_lines() { grep '^\[OK\]' <<< "$output" | tr '\n' '|'; }
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
WIREMOCK=http://localhost:8089/__admin/mappings
FAKE_BFF_STUBS=(e2e00000-0000-4000-8000-000000000401 e2e00000-0000-4000-8000-000000000200)
remove_fake_bff() { for id in "${FAKE_BFF_STUBS[@]}"; do curl -s -o /dev/null -X DELETE "$WIREMOCK/$id"; done; }
restore() {
  for app in compliance-service keycloak catalog-service; do reconnect "$app"; done
  docker start order-service > /dev/null 2>&1
  remove_fake_bff
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
check "make e2e runs scripts/e2e-smoke.sh (E2E-01)" '[ "$(make_out -n e2e)" = "bash scripts/e2e-smoke.sh" ]'
check "make help lists e2e (E2E-23)" 'make_out help | grep -q "e2e.*roda o teste ponta a ponta"'

volumes_before=$(docker volume ls -q | sort)

# E2E-02, E2E-04..E2E-08, E2E-11
e2e E2E_SKIP_UP=0
check "runs docker compose up without E2E_SKIP_UP (E2E-02)" 'has "Subindo o ambiente (docker compose up -d --build)"'
check "passes environment, authentication, import and compliance in order (E2E-04..08, E2E-11)" \
  '[[ "$(ok_lines)" == "[OK] ambiente|[OK] autenticacao|[OK] importacao|[OK] compliance|"* ]]'
first_run=$(sed -n 's/^Execucao: //p' <<< "$output")
# docker compose up may recreate a container whose image changed; from here on every run skips it.
containers_before=$(docker ps -aq --no-trunc | sort)

# E2E-03, E2E-15, E2E-16
e2e E2E_SKIP_UP=1
check "skips docker compose up with E2E_SKIP_UP=1 (E2E-03)" '! has "Subindo o ambiente"'
check "second run on the same environment exits 0 (E2E-16)" '[ "$code" = 0 ]'
second_run=$(sed -n 's/^Execucao: //p' <<< "$output")
check "each run uses a different run id in the SKUs (E2E-15)" '[ -n "$first_run" ] && [ "$first_run" != "$second_run" ]'

# E2E-09, E2E-10, E2E-18, E2E-19, E2E-21 (output of the previous run)
check "reserves and gives back the stock after compliance (E2E-09, E2E-10)" \
  '[ "$(ok_lines)" = "[OK] ambiente|[OK] autenticacao|[OK] importacao|[OK] compliance|[OK] estoque: reserva|[OK] estoque: devolucao|" ]'
check "lists the four pending steps (E2E-18)" \
  '[ "$(grep "^\[PENDENTE\]" <<< "$output" | tr "\n" "|")" = "[PENDENTE] anuncio nos marketplaces (#21)|[PENDENTE] pedido recebido do marketplace (#20, #22)|[PENDENTE] confirmacao do pedido (#20, #29)|[PENDENTE] cobranca (#23)|" ]'
check "pending steps alone keep exit 0 without E2E_STRICT (E2E-19)" '[ "$code" = 0 ]'
check "prints the summary of passed, failed and pending steps (E2E-21)" 'has "Resumo: 6 ok, 0 falha(s), 4 pendente(s)"'

# E2E-20
e2e E2E_SKIP_UP=1 E2E_STRICT=1
check "E2E_STRICT=1 fails the run when steps are pending (E2E-20)" \
  '[ "$code" = 1 ] && has "Resumo: 6 ok, 0 falha(s), 4 pendente(s)" && has "[FALHA] E2E_STRICT=1 e ha 4 etapa(s) pendente(s)"'

# E2E-12, E2E-14: compliance cannot reach Kafka, so the products stay PENDING
isolate compliance-service
e2e E2E_SKIP_UP=1
reconnect compliance-service
check "a stuck compliance fails the compliance step with exit 1 (E2E-12)" \
  '[ "$code" = 1 ] && has "[FALHA] compliance: analysisStatus de E2E-"'
check "the timeout prints the last value observed (E2E-14)" "has \"esperado 'APPROVED', ultimo valor 'PENDING' apos 60s\""
check "no step runs after the failed one (E2E-12)" '! has "[OK] estoque" && ! has "[PENDENTE]"'

# E2E-13
docker stop order-service > /dev/null
e2e E2E_SKIP_UP=1 E2E_TIMEOUT=5
docker start order-service > /dev/null
check "an unhealthy stack fails the environment step listing the service (E2E-13)" \
  '[ "$code" = 1 ] && has "[FALHA] ambiente: servicos sem healthy apos 5s: order-service=exited"'
check "a failed run still prints the summary (E2E-21)" 'has "Resumo: 0 ok, 1 falha(s), 0 pendente(s)"'
wait_healthy order-service

# E2E-06: the request without a token goes to the catalog, which answers 404 instead of 401
e2e E2E_SKIP_UP=1 BFF_PORT=8082
check "a request without token that is not refused with 401 fails the authentication step (E2E-06)" \
  '[ "$code" = 1 ] && has "[FALHA] autenticacao: importacao sem token respondeu HTTP 404, esperado 401"'

# E2E-09, E2E-24: a reserved message already keyed by the order id makes the topic hold two
order_id=$(printf '%04x%04x-%04x-4%03x-%04x-%04x%04x%04x' $RANDOM $RANDOM $RANDOM $((RANDOM & 0xfff)) \
  $(((RANDOM & 0x3fff) | 0x8000)) $RANDOM $RANDOM $RANDOM)
printf '%s|{"orderId":"%s","items":[]}\n' "$order_id" "$order_id" \
  | MSYS_NO_PATHCONV=1 docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:19092 \
    --topic catalog.stock.reserved.v1 --reader-property parse.key=true --reader-property key.separator='|' > /dev/null 2>&1
e2e E2E_SKIP_UP=1 E2E_ORDER_ID="$order_id"
check "the reservation step checks the reserved message keyed by the order id (E2E-09, E2E-24)" \
  "[ \"\$code\" = 1 ] && has \"[FALHA] estoque: reserva: mensagens em catalog.stock.reserved.v1 com a chave $order_id: esperado '1', ultimo valor '2'\""

# Edge case: Keycloak gives no token
isolate keycloak
e2e E2E_SKIP_UP=1
reconnect keycloak
check "no token fails the authentication step with the HTTP status (edge case)" \
  '[ "$code" = 1 ] && has "[FALHA] autenticacao: o Keycloak respondeu HTTP 000 sem access_token"'

# Edge case: the import does not answer 200 (the BFF cannot reach the catalog)
isolate catalog-service
e2e E2E_SKIP_UP=1
reconnect catalog-service
check "an import without 200 fails the import step with the status and body (edge case)" \
  '[ "$code" = 1 ] && grep -qE "^\[FALHA\] importacao: HTTP (500: \{.*\"status\":500|000: $)" <<< "$output"'
# The BFF's JVM caches the failed DNS lookup of catalog-service for 10 s.
sleep 15

# E2E-07: a BFF stand-in on WireMock refuses the request without token and imports only 2 products
curl -s -o /dev/null -X POST "$WIREMOCK" -H 'Content-Type: application/json' -d "{\"id\":\"${FAKE_BFF_STUBS[0]}\",
  \"priority\":1,\"request\":{\"method\":\"POST\",\"urlPath\":\"/catalog/import/xlsx\",\"headers\":{\"Authorization\":{\"absent\":true}}},
  \"response\":{\"status\":401}}"
curl -s -o /dev/null -X POST "$WIREMOCK" -H 'Content-Type: application/json' -d "{\"id\":\"${FAKE_BFF_STUBS[1]}\",
  \"priority\":2,\"request\":{\"method\":\"POST\",\"urlPath\":\"/catalog/import/xlsx\"},
  \"response\":{\"status\":200,\"headers\":{\"Content-Type\":\"application/json\"},\"body\":\"{\\\"importedProducts\\\":2}\"}}"
e2e E2E_SKIP_UP=1 BFF_PORT=8089
remove_fake_bff
check "an import that does not report 3 products fails the import step (E2E-07)" \
  '[ "$code" = 1 ] && has "[FALHA] importacao: HTTP 200: {\"importedProducts\":2}"'

# The environment works again once every container is back
e2e E2E_SKIP_UP=1
check "a normal run passes after the faults are restored" '[ "$code" = 0 ]'

# E2E-17
check "no volume was deleted (E2E-17)" '[ "$volumes_before" = "$(docker volume ls -q | sort)" ]'
check "no container was deleted or recreated by the runs that skip docker compose up (E2E-17)" \
  '[ "$containers_before" = "$(docker ps -aq --no-trunc | sort)" ]'

echo "$failures failure(s)"
[ "$failures" = 0 ]
