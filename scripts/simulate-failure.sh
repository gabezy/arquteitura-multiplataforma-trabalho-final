#!/usr/bin/env bash
# Liga e desliga os cenários de falha dos simuladores de marketplace no WireMock.
#
# O WireMock fica em WIREMOCK_URL (padrão http://localhost:8089). O modo vale até o WireMock
# reiniciar ou até `curl -X POST $WIREMOCK_URL/__admin/scenarios/reset`.
set -euo pipefail

WIREMOCK_URL="${WIREMOCK_URL:-http://localhost:8089}"
MARKETPLACES=(amazon mercadolivre shopee)

usage() {
  cat >&2 <<EOF
Uso: scripts/simulate-failure.sh <amazon|mercadolivre|shopee|all> <unavailable|throttled|slow|flaky|off>

  unavailable  toda chamada responde 503
  throttled    toda chamada responde 429, com Retry-After de 1 s
  slow         toda chamada demora 8 s e responde 504 (o gateway desiste antes, pelo timeout de 3 s)
  flaky        as 2 próximas chamadas respondem 503 e as seguintes voltam ao normal
  off          volta ao normal
EOF
  exit 1
}

[ $# -eq 2 ] || usage

case "$1" in
  all) targets=("${MARKETPLACES[@]}") ;;
  amazon | mercadolivre | shopee) targets=("$1") ;;
  *) usage ;;
esac

case "$2" in
  unavailable) state=UNAVAILABLE ;;
  throttled) state=THROTTLED ;;
  slow) state=SLOW ;;
  flaky) state=FLAKY_1 ;;
  off) state=Started ;;
  *) usage ;;
esac

for marketplace in "${targets[@]}"; do
  if ! curl -fsS -X PUT "$WIREMOCK_URL/__admin/scenarios/${marketplace}-mode/state" \
    -H 'Content-Type: application/json' \
    -d "{\"state\":\"$state\"}" > /dev/null; then
    echo "Não consegui falar com o WireMock em $WIREMOCK_URL (make up-infra sobe o WireMock)." >&2
    exit 1
  fi
  echo "$marketplace: $2"
done
