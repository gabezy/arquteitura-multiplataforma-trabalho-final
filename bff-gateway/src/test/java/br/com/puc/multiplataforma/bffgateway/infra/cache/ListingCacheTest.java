package br.com.puc.multiplataforma.bffgateway.infra.cache;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.concurrent.TimeUnit;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"spring.cache.type=redis", "app.gateways.marketplace=rest", "app.rate-limit.enabled=true"})
@AutoConfigureMockMvc
@AutoConfigureTracing
@Testcontainers
class ListingCacheTest {

    static final String UNKNOWN_ID = "6f1c2b8e-0000-4000-8000-0000000000aa";
    static final String LISTINGS_PAGE = """
            {
              "listings": [{
                "id": "6f1c2b8e-0000-4000-8000-000000000101",
                "sku": "MON-002",
                "marketplace": "AMAZON",
                "externalListingId": "AMZ-L-1",
                "status": "PUBLISHED",
                "price": 18500.00,
                "stock": 3,
                "failureReason": null,
                "updatedAt": "2026-10-28T13:05:00Z"
              }],
              "limit": 20,
              "offset": 0
            }""";

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2-alpine").withExposedPorts(6379);

    static final StubService SERVICES = StubService.start()
            .on("GET", "/listings", 200, LISTINGS_PAGE)
            .on("GET", "/listings/" + UNKNOWN_ID, 404, "{\"status\":404,\"detail\":\"listing not found\"}")
            .on("PATCH", "/products/sku/MON-002/price", 204, "");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StringRedisTemplate redis;

    @DynamicPropertySource
    static void serviceUrls(DynamicPropertyRegistry registry) {
        registry.add("marketplace-gateway.url", SERVICES::url);
        registry.add("catalog-service.url", SERVICES::url);
    }

    @AfterAll
    static void stopServices() {
        SERVICES.stop();
    }

    @BeforeEach
    void startClean() {
        SERVICES.resetCalls();
        redis.execute(connection -> {
            connection.serverCommands().flushAll();
            return null;
        }, true);
    }

    @Test
    void servesTheSecondListingPageFromTheCache() throws Exception {
        listingsPage().andExpect(status().isOk());
        listingsPage().andExpect(status().isOk());

        assertThat(SERVICES.calls("GET", "/listings")).isEqualTo(1);
    }

    @Test
    void readsTheCachedPageBackAsListings() throws Exception {
        listingsPage();

        listingsPage()
                .andExpect(jsonPath("$.listings[0].sku").value("MON-002"))
                .andExpect(jsonPath("$.listings[0].price").value(18500.00));
    }

    @Test
    void doesNotCacheAMissingListing() throws Exception {
        getListing(UNKNOWN_ID).andExpect(status().isNotFound());
        getListing(UNKNOWN_ID).andExpect(status().isNotFound());

        assertThat(SERVICES.calls("GET", "/listings/" + UNKNOWN_ID)).isEqualTo(2);
    }

    @Test
    void changingAPriceEvictsTheListings() throws Exception {
        listingsPage();

        mockMvc.perform(patch("/catalog/products/MON-002/price")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\": 17000.00}")
                        .with(withRole("store")))
                .andExpect(status().isNoContent());
        assertThat(redis.keys("listings::*")).isEmpty();
        listingsPage();

        assertThat(SERVICES.calls("GET", "/listings")).isEqualTo(2);
    }

    @Test
    void appliesTheConfiguredTtl() throws Exception {
        listingsPage();

        String key = redis.keys("listings::*").iterator().next();
        assertThat(redis.getExpire(key, TimeUnit.SECONDS)).isBetween(1L, 30L);
    }

    @Test
    void countsTheRequestInTheUsersRateLimitWindow() throws Exception {
        listingsPage().andExpect(status().isOk());

        assertThat(redis.keys("rate-limit:user:*")).singleElement()
                .satisfies(key -> assertThat(redis.opsForValue().get(key)).isEqualTo("1"));
    }

    private ResultActions listingsPage() throws Exception {
        return mockMvc.perform(get("/listings").with(withRole("store")));
    }

    private ResultActions getListing(String id) throws Exception {
        return mockMvc.perform(get("/listings/" + id).with(withRole("store")));
    }

}
