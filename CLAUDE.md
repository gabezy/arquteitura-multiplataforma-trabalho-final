# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo layout

This monorepo holds the services of the "omni-market" system. Each service sits in its own top-level directory, is self-contained (its own build and wrapper), and has its own `CLAUDE.md` with service-specific commands and architecture:

- `bff-gateway/` — backend-for-frontend / gateway (Spring Boot, OAuth2 resource server). See `bff-gateway/CLAUDE.md`.
- `catalog-service/` — catalog service (Node.js, TypeScript, Express, OpenTelemetry). See `catalog-service/CLAUDE.md`.
- `compliance-service/` — simulated product compliance checks (Python, FastAPI, uv). See `compliance-service/CLAUDE.md`.
- `order-service/` — sales orders from the marketplaces (Node.js, TypeScript, Express, OpenTelemetry). See `order-service/CLAUDE.md`.
- `marketplace-gateway/` — integration with Amazon, Mercado Livre and Shopee, simulated in WireMock (Node.js, TypeScript, Express, OpenTelemetry). See `marketplace-gateway/CLAUDE.md`.

Shared local infrastructure lives at the root:

- `docker-compose.yaml` — the whole local environment: shared infra, observability, WireMock and the applications.
- `docker/` — config mounted by those containers (e.g. `docker/keycloak/realms/` is imported by Keycloak on startup).

## Shared infrastructure

```bash
docker compose up -d --build   # start everything, building the applications
docker compose down -v         # stop and drop volumes (needed to re-import a changed realm)
```

The root `Makefile` wraps these (`make` lists targets): `up` (everything), `up-infra` (everything but the applications), `down`, `clean` (drops volumes), `restart`, `ps`, `logs s=<service>`, `topics`.

**Applications**: `bff-gateway`, `catalog-service`, `compliance-service`, `order-service` and `marketplace-gateway` are built from source and run inside the compose network (`kafka:19092`, `catalog-db:5432`, `otel-collector:4318`). To run one of them from its own directory, start the rest with `make up-infra`, which leaves out the services listed in `APPS` in the Makefile. A new service is added to the compose file and to `APPS`. Inside the network the BFF fetches Keycloak's signing keys from `keycloak:8080` (`SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWKSETURI`) but keeps validating `iss` against `http://localhost:8085/realms/omni-market`, the issuer of tokens fetched from the host. `BFF_PORT` and `GRAFANA_PORT` change the host ports when 8080 or 3000 are taken.

**Keycloak** (26.x) runs on http://localhost:8085 (admin console: `admin`/`admin`). The realm is `omni-market` and the issuer is `http://localhost:8085/realms/omni-market`.

- Realm roles: `admin`, `customer`. Services map them to `ROLE_<role>` and scopes to `SCOPE_<scope>`.
- Users: `admin`/`admin` (roles `admin` and `customer`), `customer`/`customer` (role `customer`).
- Client `bff-gateway` is confidential (secret `bff-gateway-secret`) and has direct access grants enabled, so you can get a token with:

```bash
curl -s -X POST http://localhost:8085/realms/omni-market/protocol/openid-connect/token \
  -d grant_type=password -d client_id=bff-gateway -d client_secret=bff-gateway-secret \
  -d username=admin -d password=admin
```

Realm changes go in `docker/keycloak/realms/omni-market-realm.json`. `--import-realm` skips a realm that already exists, so run `docker compose down -v` before restarting.

**Kafka** (4.x, KRaft, single broker): apps on the host use `localhost:9092`, containers use `kafka:19092`. Kafka UI runs on http://localhost:8090.

Topics are created by the one-shot `kafka-init` service, which runs `docker/kafka/create-topics.sh` once the broker is healthy. A service that publishes or consumes a new topic adds it to that script. The script is idempotent (`--if-not-exists`), so `docker compose up -d kafka-init` applies new topics without touching existing ones.

**Postgres**: one container per service. `catalog-db` on localhost:5432 (`catalog`/`catalog`), `compliance-db` on localhost:5433 (`compliance`/`compliance`), `order-db` on localhost:5434 (`orders`/`orders`), `marketplace-db` on localhost:5436 (`marketplace`/`marketplace`).

**Observability**: apps send OTLP over HTTP to the collector on http://localhost:4318. Grafana runs on http://localhost:3000 (`admin`/`admin`).

## Conventions (all services)

- Each service follows Clean Architecture (framework-free `core`, adapters in `infra`) and Clean Code. The rules are detailed per service.
- Commit messages: Conventional Commits in Portuguese (e.g. `feat: adiciona keycloak e configuração de realms`).
