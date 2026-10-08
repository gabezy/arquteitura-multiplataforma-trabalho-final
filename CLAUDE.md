# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo layout

This monorepo holds the services of the "omni-market" system. Each service sits in its own top-level directory, is self-contained (its own build and wrapper), and has its own `CLAUDE.md` with service-specific commands and architecture:

- `bff-gateway/` — backend-for-frontend / gateway (Spring Boot, OAuth2 resource server). See `bff-gateway/CLAUDE.md`.

Shared local infrastructure lives at the root:

- `compose.yaml` — local dependencies shared by all services.
- `docker/` — config mounted by those containers (e.g. `docker/keycloak/realms/` is imported by Keycloak on startup).

## Shared infrastructure

```bash
docker compose up -d      # start shared infra
docker compose down -v    # stop and drop volumes (needed to re-import a changed realm)
```

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

## Conventions (all services)

- Each service follows Clean Architecture (framework-free `core`, adapters in `infra`) and Clean Code. The rules are detailed per service.
- Commit messages: Conventional Commits in Portuguese (e.g. `feat: adiciona keycloak e configuração de realms`).
