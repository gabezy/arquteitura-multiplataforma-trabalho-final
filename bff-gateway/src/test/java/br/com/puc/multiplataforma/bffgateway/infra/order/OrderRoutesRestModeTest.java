package br.com.puc.multiplataforma.bffgateway.infra.order;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@AutoConfigureTracing
class OrderRoutesRestModeTest {

    private static final String UNKNOWN_ID = "6f1c2b8e-0000-4000-8000-0000000000aa";
    private static final String BROKEN_ID = "6f1c2b8e-0000-4000-8000-0000000000bb";
    private static final String UNAVAILABLE_ID = "6f1c2b8e-0000-4000-8000-0000000000cc";
    private static final String ORDERS_PAGE = """
            {
              "orders": [{
                "id": "6f1c2b8e-0000-4000-8000-000000000001",
                "marketplace": "AMAZON",
                "externalOrderId": "AMZ-1",
                "status": "CONFIRMED",
                "total": 18500.00,
                "items": [{"sku": "MON-002", "quantity": 1, "unitPrice": 18500.00}],
                "cancellationReason": null,
                "createdAt": "2026-10-28T13:05:00Z",
                "updatedAt": "2026-10-28T13:05:02Z",
                "somethingNew": "ignored"
              }],
              "limit": 5,
              "offset": 0
            }""";

    private static final AtomicReference<String> RECEIVED_USER_ID = new AtomicReference<>();
    private static final AtomicReference<String> RECEIVED_TRACEPARENT = new AtomicReference<>();
    private static final AtomicReference<String> RECEIVED_QUERY = new AtomicReference<>();
    private static final HttpServer ORDER_SERVICE = startOrderService();

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void orderServiceUrl(DynamicPropertyRegistry registry) {
        registry.add("order-service.url", () -> "http://127.0.0.1:" + ORDER_SERVICE.getAddress().getPort());
    }

    @AfterAll
    static void stopOrderService() {
        ORDER_SERVICE.stop(0);
    }

    @Test
    void callsTheOrderServiceByDefaultAndForwardsTheUser() throws Exception {
        mockMvc.perform(get("/orders").param("marketplace", "AMAZON").param("limit", "5")
                        .with(jwt().jwt(token -> token.subject("user-123")).authorities(new SimpleGrantedAuthority("ROLE_csm"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders[0].externalOrderId").value("AMZ-1"))
                .andExpect(jsonPath("$.orders[0].items[0].unitPrice").value(18500.00))
                .andExpect(jsonPath("$.limit").value(5));

        assertThat(RECEIVED_USER_ID.get()).isEqualTo("user-123");
        assertThat(RECEIVED_QUERY.get()).isEqualTo("marketplace=AMAZON&limit=5&offset=0");
    }

    @Test
    void propagatesTheTraceToTheOrderService() throws Exception {
        mockMvc.perform(get("/orders").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_csm"))))
                .andExpect(status().isOk());

        assertThat(RECEIVED_TRACEPARENT.get()).matches("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}");
    }

    @Test
    void returnsNotFoundWhenTheOrderServiceDoesNotKnowTheOrder() throws Exception {
        mockMvc.perform(get("/orders/" + UNKNOWN_ID).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_csm"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("order '%s' not found".formatted(UNKNOWN_ID)));
    }

    @Test
    void returnsBadGatewayWhenTheOrderServiceFails() throws Exception {
        mockMvc.perform(get("/orders/" + BROKEN_ID).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_csm"))))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.service").value("order-service"));
    }

    @Test
    void returnsServiceUnavailableWhenTheOrderServiceIsUnavailable() throws Exception {
        mockMvc.perform(get("/orders/" + UNAVAILABLE_ID).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_csm"))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("order-service is unavailable"))
                .andExpect(jsonPath("$.service").value("order-service"));
    }

    private static HttpServer startOrderService() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            server.createContext("/orders", OrderRoutesRestModeTest::answer);
            server.start();
            return server;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void answer(HttpExchange exchange) throws IOException {
        RECEIVED_USER_ID.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
        RECEIVED_TRACEPARENT.set(exchange.getRequestHeaders().getFirst("traceparent"));
        RECEIVED_QUERY.set(exchange.getRequestURI().getRawQuery());
        String path = exchange.getRequestURI().getPath();
        if (path.endsWith(UNKNOWN_ID)) {
            respond(exchange, 404, "application/problem+json", "{\"status\":404,\"detail\":\"order not found\"}");
        } else if (path.endsWith(BROKEN_ID)) {
            respond(exchange, 500, "application/problem+json", "{\"status\":500}");
        } else if (path.endsWith(UNAVAILABLE_ID)) {
            respond(exchange, 503, "application/problem+json", "{\"status\":503}");
        } else {
            respond(exchange, 200, "application/json", ORDERS_PAGE);
        }
    }

    private static void respond(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", contentType);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

}
