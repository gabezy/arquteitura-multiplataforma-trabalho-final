#!/bin/sh
# Run by the one-shot vault-init service (make vault re-runs it). Writes each service's secrets to
# KV v2 and gives the service an AppRole whose policy reads only its own path. Dev mode keeps
# everything in memory, so this runs again after every Vault restart; it is idempotent.
set -eu

if ! vault auth list | grep -q '^approle/'; then
  vault auth enable approle
fi

# configure_service <name> <role_id> <secret_id> <key=value>...
configure_service() {
  name=$1
  role_id=$2
  secret_id=$3
  shift 3

  printf 'path "secret/data/%s" {\n  capabilities = ["read"]\n}\n' "$name" | vault policy write "$name" -
  vault write auth/approle/role/"$name" token_policies="$name" token_ttl=1h secret_id_ttl=0
  vault write auth/approle/role/"$name"/role-id role_id="$role_id"
  # A custom secret_id can be registered only once, so a re-run destroys it first.
  vault write auth/approle/role/"$name"/secret-id/destroy secret_id="$secret_id" > /dev/null 2>&1 || true
  vault write auth/approle/role/"$name"/custom-secret-id secret_id="$secret_id" > /dev/null
  vault kv put secret/"$name" "$@" > /dev/null
  echo "configured $name"
}

configure_service catalog-service "$CATALOG_VAULT_ROLE_ID" "$CATALOG_VAULT_SECRET_ID" \
  db_username="$CATALOG_DB_USER" db_password="$CATALOG_DB_PASSWORD"

configure_service compliance-service "$COMPLIANCE_VAULT_ROLE_ID" "$COMPLIANCE_VAULT_SECRET_ID" \
  db_username="$COMPLIANCE_DB_USER" db_password="$COMPLIANCE_DB_PASSWORD"

configure_service bff-gateway "$BFF_VAULT_ROLE_ID" "$BFF_VAULT_SECRET_ID" \
  keycloak.client-secret="$BFF_CLIENT_SECRET"
