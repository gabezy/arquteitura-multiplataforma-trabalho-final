# Redis no bff-gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache das leituras e rate limit por usuário no bff-gateway sobre um Redis compartilhado, com o Redis no docker compose e no chart Helm do kind.

**Architecture:** Spring Cache (`@Cacheable`/`@CacheEvict`) só nas classes `*ServiceClientGateway` de `infra` (o `core` não muda). Um `CachingConfigurer` em `infra/cache` dá TTL e serializer JSON por cache e um `CacheErrorHandler` que só loga (fail-open). O rate limit é um filtro em `infra/ratelimit` depois do `BearerTokenAuthenticationFilter`, com janela fixa de 1 minuto por `sub` em `INCR`/`EXPIRE`. Senha do Redis no Vault (`secret/bff-gateway`, chave `spring.data.redis.password`).

**Tech Stack:** Spring Boot 4.1, Spring Data Redis 4 (Lettuce, Jackson 3), Testcontainers, Redis 8.2, docker compose, Helm.

**Spec:** `docs/adr/0012-cache-distribuido-no-bff-gateway.md`

## Global Constraints

- Chave do cache = argumentos da chamada ao serviço (rota + query); nunca inclui o usuário. Autorização da rota continua antes do cache (`@PreAuthorize` no controller).
- TTL curto por cache (valores na Task 1/2); escrita feita pelo BFF apaga as chaves afetadas.
- Rate limit: contador por `sub` do JWT por janela; estourou → `429` com `ProblemDetail` e `Retry-After`.
- Redis fora do ar: fail-open (cache vira miss; rate limit deixa passar). Nenhuma exceção de Redis chega ao cliente.
- `core/` não importa Spring nem Redis. Commits em Conventional Commits em português.
- Imagem `redis:8.2-alpine`; senha `REDIS_PASSWORD` (`__GENERATE__` no `.env.example`).
- Testes existentes não dependem de Redis: `src/test/resources/config/application.yaml` liga `spring.cache.type: none` e `app.rate-limit.enabled: false`; só os testes novos de Redis os religam.

## Review Focus

- `findById` que devolve `Optional.empty()` (404): não pode ir para o cache nem quebrar a chamada → `unless = "#result == null"`; teste na Task 1.
- Página genérica (`Page<Listing>`) lida de volta do Redis: tem que voltar como `Listing`, não `LinkedHashMap` → serializer com `JavaType` por cache; teste na Task 1.
- Redis cai no meio da execução: GET responde 200 vindo do serviço e o rate limit deixa passar → testes de fail-open nas Tasks 1 e 3.
- Requisição sem JWT (`/actuator/health`, Swagger): não passa pelo rate limit → teste na Task 3.
- Troca de preço que devolve 404: o evict acontecer mesmo assim é aceitável; o 404 continua 404 → coberto pelos testes existentes do `CatalogController`.

---

### Task 1: Infra de cache Redis + cache dos anúncios + evict na troca de preço

**Files:**
- Modify: `bff-gateway/pom.xml` (add `spring-boot-starter-data-redis`, `spring-boot-starter-cache`; test: `testcontainers` `GenericContainer` já vem com `testcontainers-junit-jupiter`)
- Create: `bff-gateway/src/main/java/br/com/puc/multiplataforma/bffgateway/infra/cache/CacheNames.java`
- Create: `bff-gateway/src/main/java/br/com/puc/multiplataforma/bffgateway/infra/cache/CacheTtlProperties.java`
- Create: `bff-gateway/src/main/java/br/com/puc/multiplataforma/bffgateway/infra/cache/RedisCacheConfig.java`
- Modify: `bff-gateway/src/main/java/br/com/puc/multiplataforma/bffgateway/infra/marketplace/gateway/MarketplaceServiceClientGateway.java`
- Modify: `bff-gateway/src/main/java/br/com/puc/multiplataforma/bffgateway/infra/catalog/gateway/CatalogServiceClientGateway.java` (`changePrice`)
- Modify: `bff-gateway/src/main/resources/application.yaml`, `bff-gateway/src/test/resources/config/application.yaml`
- Test: `bff-gateway/src/test/java/br/com/puc/multiplataforma/bffgateway/infra/cache/ListingCacheTest.java`

**Interfaces:**
- Produces: `final class CacheNames { LISTINGS = "listings"; LISTING = "listing"; ORDERS = "orders"; ORDER = "order"; SALES_BY_MARKETPLACE = "sales-by-marketplace"; INVOICES = "invoices"; INVOICE = "invoice"; }`
- Produces: `@ConfigurationProperties("app.cache") record CacheTtlProperties(Map<String, Duration> ttl)`
- Produces: `RedisCacheConfig implements CachingConfigurer` com `@EnableCaching`, `@EnableConfigurationProperties(CacheTtlProperties.class)`; bean `RedisCacheManagerBuilderCustomizer` que registra cada cache com TTL de `ttl` e serializer de valor tipado; `errorHandler()` devolve `LoggingCacheErrorHandler` (loga, não relança). Tasks 2 registram os tipos dos caches novos no mesmo mapa de tipos desta classe.

- [ ] **Step 1: Write the failing test**

`ListingCacheTest`: `@SpringBootTest(properties = {"spring.cache.type=redis", "app.gateways.marketplace=rest"})`, `@AutoConfigureMockMvc`, `@AutoConfigureTracing`, `@Testcontainers`; Redis por `@Container @ServiceConnection(name = "redis") static GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2-alpine").withExposedPorts(6379)`; stub do marketplace-gateway com `HttpServer` como em `OrderRoutesRestModeTest`, contando chamadas por path (`AtomicInteger`) e respondendo um `ListingPagePayload` com 1 anúncio (`sku` `MON-002`, preço `18500.00`) em `/listings` e 404 em `/listings/{UNKNOWN_ID}`; stub do catalog respondendo 204 em `PATCH /products/sku/MON-002/price` (`catalog-service.url`). `@BeforeEach` limpa contadores e faz `FLUSHALL` via `StringRedisTemplate`.

```java
@Test
void servesTheSecondListingPageFromTheCache() throws Exception {
    listingsPage(); listingsPage();
    assertThat(LISTINGS_CALLS.get()).isEqualTo(1);
}

@Test
void readsTheCachedPageBackAsListings() throws Exception {
    listingsPage();
    listingsPage().andExpect(jsonPath("$.listings[0].sku").value("MON-002"))
                  .andExpect(jsonPath("$.listings[0].price").value(18500.00));
}

@Test
void doesNotCacheAMissingListing() throws Exception {
    getListing(UNKNOWN_ID).andExpect(status().isNotFound());
    getListing(UNKNOWN_ID).andExpect(status().isNotFound());
    assertThat(LISTING_CALLS.get()).isEqualTo(2);
}

@Test
void changingAPriceEvictsTheListings() throws Exception {
    listingsPage();
    changePrice("MON-002", "17000.00").andExpect(status().isNoContent());
    listingsPage();
    assertThat(LISTINGS_CALLS.get()).isEqualTo(2);
}

@Test
void appliesTheConfiguredTtl() throws Exception {
    listingsPage();
    var key = redis.keys("listings::*").iterator().next();
    assertThat(redis.getExpire(key, TimeUnit.SECONDS)).isBetween(1L, 30L);
}
```

Use os códigos de status e o nome do campo da lista (`listings`) que `ListingController`/`ListingPageResponse` e `CatalogController` já devolvem; role com `ROLE` aceito pela matriz (`docs/matriz-de-permissoes.md`).

Segundo teste de classe, `ListingCacheFailOpenTest`: mesmo stub, sem container, `spring.data.redis.port` apontando para uma porta livre (ex. `ServerSocket(0)` fechado) e `spring.data.redis.timeout=500ms`:

```java
@Test
void answersFromTheServiceWhenRedisIsDown() throws Exception {
    listingsPage().andExpect(status().isOk());
    listingsPage().andExpect(status().isOk());
    assertThat(LISTINGS_CALLS.get()).isEqualTo(2);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd bff-gateway && ./mvnw test -Dtest='ListingCache*Test'`
Expected: FAIL (`LISTINGS_CALLS` = 2 no primeiro teste; classes de Redis inexistentes não compilam até o pom ter as deps — adicione as deps antes de rodar).

- [ ] **Step 3: Implement**

- `application.yaml`: `spring.data.redis.host: ${REDIS_HOST:localhost}`, `port: ${REDIS_PORT:6379}`, `timeout: 1s`; `spring.cache.type: redis`; `app.cache.ttl`: `listings: 30s`, `listing: 30s`, `orders: 30s`, `order: 30s`, `sales-by-marketplace: 60s`, `invoices: 30s`, `invoice: 30s`. A senha vem do Vault (`spring.data.redis.password`).
- Test `application.yaml`: `spring.cache.type: none`, `app.rate-limit.enabled: false`.
- `RedisCacheConfig`: para cada cache, `RedisCacheConfiguration.defaultCacheConfig().entryTtl(ttl).disableCachingNullValues().serializeValuesWith(...)` com `JacksonJsonRedisSerializer` construído com o `JsonMapper` do contexto e o `JavaType` do cache (`Page<Listing>` via `constructParametricType(Page.class, Listing.class)`; `Listing` direto). Confirme o nome da classe/ctor em Spring Data Redis 4 antes de escrever (Jackson 3: pacote `tools.jackson`).
- `MarketplaceServiceClientGateway.list`: `@Cacheable(cacheNames = CacheNames.LISTINGS, key = "#filter.toString() + ':' + #pageRequest.toString()")`. `findById`: `@Cacheable(cacheNames = CacheNames.LISTING, key = "#id", unless = "#result == null")`.
- `CatalogServiceClientGateway.changePrice`: `@CacheEvict(cacheNames = {CacheNames.LISTINGS, CacheNames.LISTING}, allEntries = true)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd bff-gateway && ./mvnw test`
Expected: PASS (todos, inclusive os existentes sem Redis).

- [ ] **Step 5: Commit**

```bash
git add bff-gateway
git commit -m "feat(bff-gateway): adiciona cache redis dos anúncios com evict na troca de preço"
```

### Task 2: Cache de pedidos, relatório de vendas e faturas

**Files:**
- Modify: `infra/order/gateway/OrderServiceClientGateway.java`, `infra/billing/gateway/BillingServiceClientGateway.java`, `infra/cache/RedisCacheConfig.java` (tipos dos caches novos)
- Test: `bff-gateway/src/test/java/br/com/puc/multiplataforma/bffgateway/infra/cache/OrderAndInvoiceCacheTest.java`

**Interfaces:**
- Consumes: `CacheNames`, `RedisCacheConfig` da Task 1.
- Tipos: `orders` → `Page<Order>`, `order` → `Order`, `sales-by-marketplace` → `SalesByMarketplaceReport`, `invoices` → `Page<Invoice>`, `invoice` → `Invoice`.

- [ ] **Step 1: Write the failing test** — mesma montagem da Task 1 (container Redis, stubs com contadores para order-service e billing-service, `app.gateways.order=rest`, `app.gateways.billing=rest`):

```java
@Test void servesTheSecondOrderPageFromTheCache()      // GET /orders x2 → ORDERS_CALLS == 1, items[0].unitPrice == 18500.00
@Test void cachesTheSalesReportPerPeriod()             // from/to iguais x2 → 1 chamada; período diferente → 2
@Test void servesTheSecondInvoiceFromTheCache()        // GET /invoices/{id} x2 → INVOICE_CALLS == 1
@Test void doesNotCacheAMissingOrder()                 // 404 x2 → 2 chamadas
```

- [ ] **Step 2: Run** `cd bff-gateway && ./mvnw test -Dtest=OrderAndInvoiceCacheTest` → FAIL (contadores = 2).
- [ ] **Step 3: Implement** — `@Cacheable` nos métodos `list`, `findById`, `salesByMarketplace` (chave `#period.toString()`) e `list`/`findById` de faturas, com o mesmo padrão de chave e `unless` da Task 1; registrar os tipos no `RedisCacheConfig`.
- [ ] **Step 4: Run** `cd bff-gateway && ./mvnw test` → PASS.
- [ ] **Step 5: Commit** `feat(bff-gateway): cacheia pedidos, relatório de vendas e faturas no redis`

### Task 3: Rate limit por usuário

**Files:**
- Create: `infra/ratelimit/RateLimitProperties.java`, `infra/ratelimit/RateLimiter.java`, `infra/ratelimit/RateLimitDecision.java`, `infra/ratelimit/RedisRateLimiter.java`, `infra/ratelimit/RateLimitFilter.java`, `infra/ratelimit/RateLimitConfig.java`
- Modify: `infra/security/SecurityConfig.java`, `src/main/resources/application.yaml`
- Test: `infra/ratelimit/RedisRateLimiterTest.java` (Testcontainers Redis), `infra/ratelimit/RateLimitFilterTest.java` (`@WebMvcTest(ListingController.class)` + `@Import(SecurityConfig.class)` + `@MockitoBean RateLimiter`)

**Interfaces:**
- Produces: `@ConfigurationProperties("app.rate-limit") record RateLimitProperties(boolean enabled, int requestsPerMinute)`; yaml: `enabled: true`, `requests-per-minute: 100`.
- Produces: `interface RateLimiter { RateLimitDecision tryAcquire(String userId); }`, `record RateLimitDecision(boolean allowed, long retryAfterSeconds)`.
- Produces: `RedisRateLimiter(StringRedisTemplate redis, int requestsPerMinute, Clock clock)`: chave `rate-limit:{userId}:{epochMinute}`; `INCR`; se resultado == 1, `EXPIRE` 60s; `allowed = count <= requestsPerMinute`; `retryAfterSeconds` = segundos até o fim do minuto (mín. 1). `DataAccessException` → loga em `warn` e devolve permitido (fail-open).
- Produces: `RateLimitFilter(RateLimiter)` (`OncePerRequestFilter`): sem `JwtAuthenticationToken` no contexto → segue; negado → `429`, `Retry-After`, corpo `ProblemDetail` (`title` "Too Many Requests", `detail` "Rate limit exceeded") em `application/problem+json`.
- `RateLimitConfig`: `@ConditionalOnProperty(name = "app.rate-limit.enabled", havingValue = "true", matchIfMissing = true)` cria `RateLimiter` com `Clock.systemUTC()`.
- `SecurityConfig.securityFilterChain(HttpSecurity http, ObjectProvider<RateLimiter> rateLimiter)`: se houver bean, `addFilterAfter(new RateLimitFilter(limiter), BearerTokenAuthenticationFilter.class)`. Os `@WebMvcTest` atuais seguem sem o bean e sem o filtro.

- [ ] **Step 1: Write the failing tests**

`RedisRateLimiterTest` (limite 3, `Clock.fixed` em `2026-10-26T10:00:15Z`):
```java
@Test void allowsUpToTheLimitInTheSameMinute()   // 3x allowed; 4ª → !allowed, retryAfterSeconds == 45
@Test void countsEachUserSeparately()            // user-a 4x, user-b 1x → user-b allowed
@Test void startsOverInTheNextMinute()           // clock +60s → allowed
@Test void expiresTheCounter()                   // getExpire(key) in 1..60
@Test void allowsWhenRedisIsDown()               // template apontando para porta livre → allowed
```
`RateLimitFilterTest`:
```java
@Test void returns429WithRetryAfterWhenDenied()  // tryAcquire("user-123") → (false, 45): status 429, header Retry-After "45", jsonPath $.title "Too Many Requests"
@Test void passesWhenAllowed()                   // (true, 0) → 200 (ListListings mockado)
@Test void skipsRequestsWithoutAToken()          // GET sem jwt → 401 e verifyNoInteractions(rateLimiter)
```

- [ ] **Step 2: Run** `cd bff-gateway && ./mvnw test -Dtest='RedisRateLimiterTest,RateLimitFilterTest'` → FAIL (não compila).
- [ ] **Step 3: Implement** conforme Interfaces.
- [ ] **Step 4: Run** `cd bff-gateway && ./mvnw test` → PASS.
- [ ] **Step 5: Commit** `feat(bff-gateway): adiciona rate limit por usuário no redis`

### Task 4: Redis no docker compose, Vault e docs

**Files:**
- Modify: `docker-compose.yaml` (serviço `redis`; `vault-init` e `bff-gateway`), `.env.example`, `docker/vault/bootstrap.sh`, `k8s/helm/omni-market/files/vault-bootstrap.sh` (cópia idêntica), `CLAUDE.md`, `bff-gateway/CLAUDE.md`

**Interfaces:**
- `.env.example`: `REDIS_PASSWORD=__GENERATE__` com comentário.
- `redis` no compose: `image: redis:8.2-alpine`, `container_name: redis`, `command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?run make env}"]`, porta `6379:6379`, healthcheck `redis-cli -a "$$REDIS_PASSWORD" ping` (passar `REDIS_PASSWORD` no `environment`), sem volume (cache é descartável).
- `vault-init`: env `REDIS_PASSWORD`; `bootstrap.sh`: `configure_service bff-gateway ... keycloak.client-secret="$BFF_CLIENT_SECRET" spring.data.redis.password="$REDIS_PASSWORD"`.
- `bff-gateway` no compose: `REDIS_HOST: redis`; `depends_on: redis: condition: service_healthy`.
- Docs: Redis em localhost:6379 e a chave nova do Vault na seção Vault do `CLAUDE.md` raiz; `bff-gateway/CLAUDE.md` descreve `infra/cache`, `infra/ratelimit`, as propriedades `app.cache.ttl.*` / `app.rate-limit.*` e que testes desligam ambos.

- [ ] **Step 1: Validate config** — `docker compose config -q` → sem erro; `diff docker/vault/bootstrap.sh k8s/helm/omni-market/files/vault-bootstrap.sh` → vazio.
- [ ] **Step 2: Smoke** — `make env && docker compose up -d --build redis vault vault-init bff-gateway` (e dependências); `docker exec vault-init`… não precisa: `curl -s -H "X-Vault-Token: $VAULT_ROOT_TOKEN" localhost:8200/v1/secret/data/bff-gateway | jq '.data.data | keys'` contém `spring.data.redis.password`. Com token de `csm`, `GET localhost:8080/listings` 2x → `docker exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'listings::*'` lista 1 chave e `--scan --pattern 'rate-limit:*'` lista 1 chave.
- [ ] **Step 3: Fail-open smoke** — `docker stop redis`; `GET /listings` → 200; `docker start redis`.
- [ ] **Step 4: Commit** `feat(compose): adiciona redis para o bff-gateway com senha no vault`

### Task 5: Redis no chart Helm (kind)

**Files:**
- Modify: `k8s/helm/omni-market/values.yaml` (entrada `redis` em `infrastructure`; env `REDIS_HOST` no `bff-gateway`), `k8s/helm/omni-market/templates/keycloak-vault-kafka.yaml` (env `REDIS_PASSWORD` do `omni-market-secrets` no Job `vault-init`), `docs/kubernetes-kind.md` (se listar componentes)

**Interfaces:**
- `infrastructure` entry: `name: redis`, `image: redis:8.2-alpine`, `port: 6379`, `command: ["redis-server", "--requirepass", "$(REDIS_PASSWORD)"]`, `env` com `REDIS_PASSWORD` via `valueFrom.secretKeyRef` (`omni-market-secrets`, chave `REDIS_PASSWORD`) — o template faz `toYaml .env`, então `valueFrom` passa direto; sem `healthPath`, sem `nodePort`.
- `bff-gateway` env: `{ name: REDIS_HOST, value: redis }`.

- [ ] **Step 1: Render** — `helm template omni-market k8s/helm/omni-market | grep -A20 'name: redis'` mostra Deployment com `args` contendo `$(REDIS_PASSWORD)` e Service na 6379; `helm lint k8s/helm/omni-market` → 0 failures.
- [ ] **Step 2: Deploy (se o cluster existir)** — `make k8s-apply`; `kubectl -n omni-market get pods` com `redis` Running e `bff-gateway` Ready; `kubectl -n omni-market exec deploy/redis -- sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'` → `PONG`.
- [ ] **Step 3: Commit** `feat(k8s): adiciona redis ao chart para o bff-gateway`
