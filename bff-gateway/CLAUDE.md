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

Base package: `br.com.puc.multiplataforma.bffgateway`. It has two top-level layers, and dependencies point inward only:

- `core/` — business rules: entities, use cases (`core/usecase`), and the port interfaces the use cases need (for example, gateways to downstream services). It must not depend on Spring, servlet, Jackson, or anything in `infra`. Use cases are plain Java classes with constructor injection. They are not annotated with `@Service`/`@Component`.
- `infra/` — adapters and frameworks: REST controllers, security, exception handling, `RestClient` implementations of core ports, and Spring `@Configuration` that wires the use cases as `@Bean`s.

Rules to keep when adding code:
- Controllers convert HTTP DTOs to use-case input and back. They hold no business logic.
- When a use case needs external data, add an interface in `core` and implement it in `infra`. `core` never calls `RestClient` directly.
- Framework exceptions are translated in `infra/exception/ExceptionHandler` (extends `ResponseEntityExceptionHandler`). Core throws its own domain exceptions.
- Follow Clean Code: small, intention-revealing names, single responsibility per class/method, and no comments that restate the code.

## Security model

- `infra/security/SecurityConfig` sets up a stateless resource server: CSRF is disabled (auth is by Bearer header only, not cookies), sessions are `STATELESS`, `/actuator/**` and the Swagger paths are `permitAll`, and everything else is `authenticated()`.
- `KeycloakJwtAuthenticationConverter` merges two sources of authorities:
  - `scope` claim → `SCOPE_<scope>` (via `JwtGrantedAuthoritiesConverter`)
  - `realm_access.roles` → `ROLE_<role>`, so `hasRole('admin')` works. Role names are lowercase, as in Keycloak.
- Fine-grained authorization is done per endpoint with `@PreAuthorize` (`@EnableMethodSecurity` is on), for example `hasRole('admin') or hasAuthority('SCOPE_catalog:write')`.
- Security tests use `@WebMvcTest(Controller.class)` + `@Import(SecurityConfig.class)` + `@MockitoBean JwtDecoder`. Use `jwt().authorities(...)` to test authorization rules. Use a mocked `JwtDecoder` with an `Authorization: Bearer` header to test that the Keycloak converter is wired into the chain. In Boot 4, `WebMvcTest` is in `org.springframework.boot.webmvc.test.autoconfigure`.
