package br.com.puc.multiplataforma.bffgateway.infra.cache;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Redis stops answering after the BFF is already connected: the open connection times out instead of being
 * refused, and both the cache and the rate limit must still let the request through.
 */
@SpringBootTest(properties = {"spring.cache.type=redis", "app.gateways.marketplace=rest", "app.rate-limit.enabled=true"})
@AutoConfigureMockMvc
@AutoConfigureTracing
@Testcontainers
class RedisDownMidRunTest {

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2-alpine").withExposedPorts(6379);

    static final StubService SERVICES = StubService.start()
            .on("GET", "/listings", 200, ListingCacheTest.LISTINGS_PAGE);

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void serviceUrls(DynamicPropertyRegistry registry) {
        registry.add("marketplace-gateway.url", SERVICES::url);
    }

    @AfterAll
    static void stopServices() {
        SERVICES.stop();
    }

    @Test
    void answersWhenRedisStopsAnsweringMidRun() throws Exception {
        mockMvc.perform(get("/listings").with(withRole("store"))).andExpect(status().isOk());

        REDIS.getDockerClient().pauseContainerCmd(REDIS.getContainerId()).exec();
        try {
            mockMvc.perform(get("/listings").with(withRole("store"))).andExpect(status().isOk());
            mockMvc.perform(get("/listings").with(withRole("store"))).andExpect(status().isOk());
        } finally {
            REDIS.getDockerClient().unpauseContainerCmd(REDIS.getContainerId()).exec();
        }

        assertThat(SERVICES.calls("GET", "/listings")).isEqualTo(3);
    }

    @Test
    void staysHealthyWhenRedisStopsAnswering() throws Exception {
        REDIS.getDockerClient().pauseContainerCmd(REDIS.getContainerId()).exec();
        try {
            mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
        } finally {
            REDIS.getDockerClient().unpauseContainerCmd(REDIS.getContainerId()).exec();
        }
    }

}
