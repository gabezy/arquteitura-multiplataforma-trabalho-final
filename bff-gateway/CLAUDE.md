# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`bff-gateway` is one service in a monorepo of services for the "omni-market" system. It is a Spring Boot 4.1 / Java 25 Maven project that acts as the backend-for-frontend and gateway, and it is an OAuth2 resource server that authenticates against Keycloak.

Shared infrastructure (Keycloak, realm users, getting a token) and monorepo-wide conventions are described in `../CLAUDE.md`.

## Commands

Run the commands from this directory:

```bash
make -C .. up-infra                        # infra without the apps: Keycloak on http://localhost:8085
./mvnw spring-boot:run                     # run the BFF (needs Keycloak for the issuer-uri and Vault, see below)
./mvnw test                                # all tests
./mvnw test -Dtest=CatalogControllerSecurityTest                        # one class
./mvnw test -Dtest='CatalogControllerSecurityTest#returnsOkForAdmin'    # one method
./mvnw package                             # build jar
```

Secrets come from Vault through Spring Cloud Vault (`spring.config.import: optional:vault://` in `application.yaml`, `../docs/adr/0003-vault-para-secrets-das-aplicacoes.md`). The BFF logs in with the AppRole in `VAULT_ADDR` / `VAULT_ROLE_ID` / `VAULT_SECRET_ID` (export `BFF_VAULT_ROLE_ID` / `_SECRET_ID` from the root `.env` under those names) and reads `secret/bff-gateway` (`default-context` is off: the policy denies `secret/application`). `keycloak.client-secret` binds to `infra/security/KeycloakClientProperties`, which is `@NotBlank`, so the app does not start without it. New BFF credentials (e.g. Redis) go in the same path. Tests turn Vault off in `src/test/resources/config/application.yaml` and set a fixed client secret there.

`TestcontainersConfiguration` starts a `grafana/otel-lgtm` container, so any test that imports it needs Docker. `@WebMvcTest` slices and plain unit tests don't need Docker.

## Architecture: Clean Architecture

Base package: `br.com.puc.multiplataforma.bffgateway`. It has two top-level layers, and dependencies point inward only. Inside each layer, code is grouped **by domain first, then by technical role**:

```
core/<domain>/            e.g. core/catalog
  domain/                 entities and value objects (records that validate themselves)
  exception/              domain exceptions
  gateway/                port interfaces the use cases depend on (downstream services, file readers)
  usecase/                one class per use case + its result record
core/shared/              only for code used by more than one domain: Marketplace, Page, PageRequest and the exceptions of downstream calls
infra/<domain>/           e.g. infra/catalog
  controller/ (+ dto/)    REST endpoints and HTTP DTOs
  gateway/                implementations of core gateways (RestClient, mocks)
  <adapter>/              other adapters, e.g. spreadsheet/ (Apache POI)
  config/                 @Configuration that wires the domain's use cases and adapters as @Beans
infra/security/, infra/exception/   cross-cutting concerns shared by all domains
infra/shared/            gateway/ and config/: the HTTP client every downstream gateway uses (DownstreamClient)
```

- `core` must not depend on Spring, servlet, Jackson, or anything in `infra`. Use cases are plain Java classes with constructor injection. They are not annotated with `@Service`/`@Component`.
- A new downstream domain (order, cart, …) gets its own `core/<domain>` and `infra/<domain>`. One domain must not reach into another domain's `infra`.
- The `order`, `billing` and `marketplace` domains each have two gateways behind their port: `Mock<Domain>Gateway` (in-memory demo data) and `<Service>ClientGateway` (calls the service). The domain's `@Configuration` activates one with `app.gateways.<domain>=mock|rest` (default `rest`; the env var `APP_GATEWAYS_ORDER=mock` works too). The URLs are `ORDER_SERVICE_URL` (default `http://order-service:8084`), `BILLING_SERVICE_URL` (default `http://billing-service:8086`) and `MARKETPLACE_GATEWAY_URL` (default `http://marketplace-gateway:8087`); from the host use `http://localhost:<port>`. A new downstream domain repeats this pattern.

Rules to keep when adding code:
- Controllers convert HTTP DTOs to use-case input and back. They hold no business logic.
- When a use case needs external data, add an interface in `core` and implement it in `infra`. `core` never calls `RestClient` directly.
- Core throws its own domain exceptions. `infra/exception/GlobalExceptionHandler` (extends `ResponseEntityExceptionHandler`) translates them into `ProblemDetail` responses.
- Follow Clean Code: small, intention-revealing names, single responsibility per class/method, and no comments that restate the code.

## Calling the other services

- A gateway wraps a `DownstreamClient`, which `DownstreamClientFactory` builds from the auto-configured `RestClient.Builder`: base URL, `X-User-Id` (the token `sub`), HTTP/1.1 and the timeouts `downstream.connect-timeout` (2s) and `downstream.read-timeout` (10s).
- `DownstreamClient` turns every failure into a core exception, and `GlobalExceptionHandler` into a `ProblemDetail`: 404 on a detail `find` is `Optional.empty()` (the use case throws `ResourceNotFoundException`, 404); 400 or 422 is `InvalidRequestException` (400, with the service's `detail`); an I/O error, a timeout, or 502, 503 or 504 is `DownstreamUnavailableException` (503); anything else, including an unreadable body or an unknown enum value, is `DownstreamFailureException` (502). Both 5xx problems carry a `service` property.
- The wire format lives in `infra/<domain>/gateway/model` (records with `toDomain()`, unknown fields ignored), so a change in a service's contract touches only the adapter. The contracts the BFF expects are in `../docs/api-do-bff.md`.
- A new route comes with a controller test, a security test (one allowed and one denied role) and a gateway test with `MockRestServiceServer`, including the service-unavailable case.
- The mock gateways share one demo story (same order ids, SKUs and prices across orders, invoices and listings), and `MockDemoDataConsistencyTest` keeps them in step. Full-context tests that use the mocks put `@MockGatewaysTest` on the class, so they share one Spring context.

## Security model

- `infra/security/SecurityConfig` sets up a stateless resource server: CSRF is disabled (auth is by Bearer header only, not cookies), sessions are `STATELESS`, `/actuator/**` and the Swagger paths are `permitAll`, and everything else is `authenticated()`.
- `KeycloakJwtAuthenticationConverter` merges two sources of authorities:
  - `scope` claim → `SCOPE_<scope>` (via `JwtGrantedAuthoritiesConverter`)
  - `realm_access.roles` → `ROLE_<role>`, so `hasRole('admin')` works. Role names are lowercase, as in Keycloak.
- Fine-grained authorization is done per endpoint with `@PreAuthorize` (`@EnableMethodSecurity` is on), for example `hasAnyRole('admin', 'store') or hasAuthority('SCOPE_catalog:write')`.
- The roles are the C4 personas: `admin` (everything), `store`, `specialist`, `fiscal` and `csm`, plus the legacy `customer`, which reaches no business route. The route × role matrix is `../docs/matriz-de-permissoes.md`: a new route gets its row there first, its `@PreAuthorize` always includes `admin`, and its security test covers one allowed and one denied role.
- Calls from the BFF to the other services carry no token, only the `X-User-Id` header (`AuthenticatedUserHeaderInterceptor`). The decision is in `../docs/adr/0009-chamada-entre-servicos-sem-token-na-rede-interna.md`.
- Security tests use `@WebMvcTest(Controller.class)` + `@Import(SecurityConfig.class)` + `@MockitoBean JwtDecoder`. Use `jwt().authorities(...)` to test authorization rules. Use a mocked `JwtDecoder` with an `Authorization: Bearer` header to test that the Keycloak converter is wired into the chain. In Boot 4, `WebMvcTest` is in `org.springframework.boot.webmvc.test.autoconfigure`.
