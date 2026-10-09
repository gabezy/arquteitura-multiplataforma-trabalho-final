# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`bff-gateway` is one service in a monorepo of services for the "omni-market" system. It is a Spring Boot 4.1 / Java 25 Maven project that acts as the backend-for-frontend and gateway, and it is an OAuth2 resource server that authenticates against Keycloak.

Shared infrastructure (Keycloak, realm users, getting a token) and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
docker compose -f ../compose.yaml up -d    # Keycloak on http://localhost:8085
./mvnw spring-boot:run                     # run the BFF (needs Keycloak for the issuer-uri)
./mvnw test                                # all tests
./mvnw test -Dtest=CatalogControllerSecurityTest                        # one class
./mvnw test -Dtest='CatalogControllerSecurityTest#returnsOkForAdmin'    # one method
./mvnw package                             # build jar
```

`TestcontainersConfiguration` starts a `grafana/otel-lgtm` container, so any test that imports it needs Docker. `@WebMvcTest` slices and plain unit tests don't need Docker.

## Architecture: Clean Architecture

Base package: `br.com.puc.multiplataforma.bffgateway`. It has two top-level layers, and dependencies point inward only. Inside each layer, code is grouped **by domain first, then by technical role**:

```
core/<domain>/            e.g. core/catalog
  domain/                 entities and value objects (records that validate themselves)
  exception/              domain exceptions
  gateway/                port interfaces the use cases depend on (downstream services, file readers)
  usecase/                one class per use case + its result record
core/shared/              only for code used by more than one domain
infra/<domain>/           e.g. infra/catalog
  controller/ (+ dto/)    REST endpoints and HTTP DTOs
  gateway/                implementations of core gateways (RestClient, mocks)
  <adapter>/              other adapters, e.g. spreadsheet/ (Apache POI)
  config/                 @Configuration that wires the domain's use cases and adapters as @Beans
infra/security/, infra/exception/   cross-cutting concerns shared by all domains
```

- `core` must not depend on Spring, servlet, Jackson, or anything in `infra`. Use cases are plain Java classes with constructor injection. They are not annotated with `@Service`/`@Component`.
- A new downstream domain (order, cart, …) gets its own `core/<domain>` and `infra/<domain>`. One domain must not reach into another domain's `infra`.
- `MockCatalogGateway` stands in for the catalog service's REST API. To call the real API, add a `RestClient` implementation of `CatalogGateway` and switch the bean in `CatalogConfig`.

Rules to keep when adding code:
- Controllers convert HTTP DTOs to use-case input and back. They hold no business logic.
- When a use case needs external data, add an interface in `core` and implement it in `infra`. `core` never calls `RestClient` directly.
- Core throws its own domain exceptions. `infra/exception/GlobalExceptionHandler` (extends `ResponseEntityExceptionHandler`) translates them into `ProblemDetail` responses.
- Follow Clean Code: small, intention-revealing names, single responsibility per class/method, and no comments that restate the code.

## Security model

- `infra/security/SecurityConfig` sets up a stateless resource server: CSRF is disabled (auth is by Bearer header only, not cookies), sessions are `STATELESS`, `/actuator/**` and the Swagger paths are `permitAll`, and everything else is `authenticated()`.
- `KeycloakJwtAuthenticationConverter` merges two sources of authorities:
  - `scope` claim → `SCOPE_<scope>` (via `JwtGrantedAuthoritiesConverter`)
  - `realm_access.roles` → `ROLE_<role>`, so `hasRole('admin')` works. Role names are lowercase, as in Keycloak.
- Fine-grained authorization is done per endpoint with `@PreAuthorize` (`@EnableMethodSecurity` is on), for example `hasRole('admin') or hasAuthority('SCOPE_catalog:write')`.
- Security tests use `@WebMvcTest(Controller.class)` + `@Import(SecurityConfig.class)` + `@MockitoBean JwtDecoder`. Use `jwt().authorities(...)` to test authorization rules. Use a mocked `JwtDecoder` with an `Authorization: Bearer` header to test that the Keycloak converter is wired into the chain. In Boot 4, `WebMvcTest` is in `org.springframework.boot.webmvc.test.autoconfigure`.
