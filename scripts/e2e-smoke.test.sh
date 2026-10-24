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
restore() {
  for app in compliance-service keycloak catalog-service; do reconnect "$app"; done
  docker start order-service > /dev/null 2>&1
}
trap restore EXIT

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
wait_healthy order-service

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
  '[ "$code" = 1 ] && has "[FALHA] importacao: HTTP 500: {" && has "\"status\":500"'
# The BFF's JVM caches the failed DNS lookup of catalog-service for 10 s.
sleep 15

# The environment works again once every container is back
e2e E2E_SKIP_UP=1
check "a normal run passes after the faults are restored" '[ "$code" = 0 ]'

# E2E-17
check "no volume was deleted (E2E-17)" '[ "$volumes_before" = "$(docker volume ls -q | sort)" ]'
check "no container was deleted or recreated by the runs that skip docker compose up (E2E-17)" \
  '[ "$containers_before" = "$(docker ps -aq --no-trunc | sort)" ]'

echo "$failures failure(s)"
[ "$failures" = 0 ]
