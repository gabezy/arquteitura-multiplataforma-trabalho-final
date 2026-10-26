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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"spring.cache.type=redis", "app.gateways.order=rest", "app.gateways.billing=rest"})
@AutoConfigureMockMvc
@AutoConfigureTracing
@Testcontainers
class OrderAndInvoiceCacheTest {

    static final String UNKNOWN_ORDER_ID = "6f1c2b8e-0000-4000-8000-0000000000aa";
    static final String INVOICE_ID = "1d7e3a10-0000-4000-8000-000000000002";
    static final String ORDERS_PAGE = """
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
                "updatedAt": "2026-10-28T13:05:02Z"
              }],
              "limit": 20,
              "offset": 0
            }""";
    static final String SALES_REPORT = """
            {
              "from": "2026-10-01",
              "to": "2026-10-31",
              "marketplaces": [{"marketplace": "AMAZON", "orders": 3, "units": 5, "totalAmount": 75000.00}]
            }""";
    static final String INVOICE = """
            {
              "id": "1d7e3a10-0000-4000-8000-000000000002",
              "orderId": "6f1c2b8e-0000-4000-8000-000000000002",
              "externalOrderId": "AMZ-1000001",
              "marketplace": "AMAZON",
              "status": "PAID",
              "amount": 111000.00,
              "commissionPercent": 12.00,
              "commissionAmount": 13320.00,
              "netAmount": 97680.00,
              "items": [{"sku": "MON-002", "quantity": 6, "unitPrice": 18500.00, "amount": 111000.00}],
              "issuedAt": "2026-10-28T13:10:03Z",
              "cancelledAt": null,
              "cancellationReason": null,
              "pspTransactionId": "ch_1d7e3a10",
              "failureReason": null,
              "paidAt": "2026-10-28T13:10:06Z",
              "failedAt": null
            }""";

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2-alpine").withExposedPorts(6379);

    static final StubService SERVICES = StubService.start()
            .on("GET", "/orders", 200, ORDERS_PAGE)
            .on("GET", "/orders/" + UNKNOWN_ORDER_ID, 404, "{\"status\":404,\"detail\":\"order not found\"}")
            .on("GET", "/reports/sales-by-marketplace", 200, SALES_REPORT)
            .on("GET", "/invoices/" + INVOICE_ID, 200, INVOICE);

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StringRedisTemplate redis;

    @DynamicPropertySource
    static void serviceUrls(DynamicPropertyRegistry registry) {
        registry.add("order-service.url", SERVICES::url);
        registry.add("billing-service.url", SERVICES::url);
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
    void servesTheSecondOrderPageFromTheCache() throws Exception {
        perform(get("/orders"), "csm").andExpect(status().isOk());
        perform(get("/orders"), "csm")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders[0].items[0].unitPrice").value(18500.00));

        assertThat(SERVICES.calls("GET", "/orders")).isEqualTo(1);
    }

    @Test
    void doesNotCacheAMissingOrder() throws Exception {
        perform(get("/orders/" + UNKNOWN_ORDER_ID), "csm").andExpect(status().isNotFound());
        perform(get("/orders/" + UNKNOWN_ORDER_ID), "csm").andExpect(status().isNotFound());

        assertThat(SERVICES.calls("GET", "/orders/" + UNKNOWN_ORDER_ID)).isEqualTo(2);
    }

    @Test
    void cachesTheSalesReportPerPeriod() throws Exception {
        salesReport("2026-10-01", "2026-10-31").andExpect(status().isOk());
        salesReport("2026-10-01", "2026-10-31")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.marketplaces[0].totalAmount").value(75000.00));
        assertThat(SERVICES.calls("GET", "/reports/sales-by-marketplace")).isEqualTo(1);

        salesReport("2026-09-01", "2026-09-30").andExpect(status().isOk());
        assertThat(SERVICES.calls("GET", "/reports/sales-by-marketplace")).isEqualTo(2);
    }

    @Test
    void servesTheSecondInvoiceFromTheCache() throws Exception {
        perform(get("/invoices/" + INVOICE_ID), "fiscal").andExpect(status().isOk());
        perform(get("/invoices/" + INVOICE_ID), "fiscal")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].unitPrice").value(18500.00));

        assertThat(SERVICES.calls("GET", "/invoices/" + INVOICE_ID)).isEqualTo(1);
    }

    private ResultActions salesReport(String from, String to) throws Exception {
        return perform(get("/reports/sales-by-marketplace").param("from", from).param("to", to), "csm");
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String role) throws Exception {
        return mockMvc.perform(request.with(withRole(role)));
    }

}
