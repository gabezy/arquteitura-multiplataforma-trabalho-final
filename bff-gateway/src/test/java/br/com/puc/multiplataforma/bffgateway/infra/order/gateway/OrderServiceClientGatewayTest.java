package br.com.puc.multiplataforma.bffgateway.infra.order.gateway;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class OrderServiceClientGatewayTest {

    private static final String BASE_URL = "http://order-service:8084";
    private static final String ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";
    private static final String ORDER_JSON = """
            {
              "id": "6f1c2b8e-0000-4000-8000-000000000001",
              "marketplace": "MERCADO_LIVRE",
              "externalOrderId": "ML-2000001",
              "status": "PAID",
              "total": 18500.00,
              "items": [{"sku": "MON-002", "quantity": 1, "unitPrice": 18500.00}],
              "cancellationReason": null,
              "createdAt": "2026-10-28T13:05:00Z",
              "updatedAt": "2026-10-28T13:05:06Z",
              "somethingNew": "fields the BFF does not know are ignored"
            }""";

    private final RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final OrderServiceClientGateway gateway =
            new OrderServiceClientGateway(new DownstreamClient("order-service", builder.build()));

    @Test
    void listsOrdersWithTheFiltersAndThePagination() {
        server.expect(requestTo(BASE_URL + "/orders?marketplace=MERCADO_LIVRE&status=PAID&limit=5&offset=10"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {"orders": [%s], "limit": 5, "offset": 10}""".formatted(ORDER_JSON), MediaType.APPLICATION_JSON));

        Page<Order> page = gateway.list(new OrderFilter(Marketplace.MERCADO_LIVRE, OrderStatus.PAID), new PageRequest(5, 10));

        assertThat(page.limit()).isEqualTo(5);
        assertThat(page.offset()).isEqualTo(10);
        assertThat(page.items()).singleElement().satisfies(order -> {
            assertThat(order.id()).isEqualTo(UUID.fromString(ORDER_ID));
            assertThat(order.marketplace()).isEqualTo(Marketplace.MERCADO_LIVRE);
            assertThat(order.externalOrderId()).isEqualTo("ML-2000001");
            assertThat(order.status()).isEqualTo(OrderStatus.PAID);
            assertThat(order.total()).isEqualByComparingTo("18500.00");
            assertThat(order.items()).extracting(OrderItem::sku, OrderItem::quantity).containsExactly(tuple("MON-002", 1));
            assertThat(order.items().getFirst().unitPrice()).isEqualByComparingTo("18500.00");
            assertThat(order.cancellationReason()).isNull();
            assertThat(order.createdAt()).isEqualTo(Instant.parse("2026-10-28T13:05:00Z"));
            assertThat(order.updatedAt()).isEqualTo(Instant.parse("2026-10-28T13:05:06Z"));
        });
        server.verify();
    }

    @Test
    void omitsTheFiltersThatWereNotInformed() {
        server.expect(requestTo(BASE_URL + "/orders?limit=20&offset=0"))
                .andRespond(withSuccess("{\"orders\": [], \"limit\": 20, \"offset\": 0}", MediaType.APPLICATION_JSON));

        Page<Order> page = gateway.list(new OrderFilter(null, null), PageRequest.of(null, null));

        assertThat(page.items()).isEmpty();
        server.verify();
    }

    @Test
    void treatsMissingListsAsEmpty() {
        server.expect(requestTo(BASE_URL + "/orders?limit=20&offset=0"))
                .andRespond(withSuccess("""
                        {"orders": [{"id": "6f1c2b8e-0000-4000-8000-000000000001", "status": "RECEIVED"}], "limit": 20, "offset": 0}""",
                        MediaType.APPLICATION_JSON));

        Page<Order> page = gateway.list(new OrderFilter(null, null), PageRequest.of(null, null));

        assertThat(page.items()).singleElement().satisfies(order -> assertThat(order.items()).isEmpty());
    }

    @Test
    void findsAnOrderById() {
        server.expect(requestTo(BASE_URL + "/orders/" + ORDER_ID))
                .andRespond(withSuccess(ORDER_JSON, MediaType.APPLICATION_JSON));

        assertThat(gateway.findById(UUID.fromString(ORDER_ID)))
                .hasValueSatisfying(order -> assertThat(order.externalOrderId()).isEqualTo("ML-2000001"));
        server.verify();
    }

    @Test
    void findsNothingWhenTheOrderServiceDoesNotKnowTheOrder() {
        server.expect(requestTo(BASE_URL + "/orders/" + ORDER_ID)).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(gateway.findById(UUID.fromString(ORDER_ID))).isEmpty();
    }

    @Test
    void readsTheSalesReportOfThePeriod() {
        server.expect(requestTo(BASE_URL + "/reports/sales-by-marketplace?from=2026-10-01&to=2026-10-31"))
                .andRespond(withSuccess("""
                        {
                          "from": "2026-10-01",
                          "to": "2026-10-31",
                          "marketplaces": [{"marketplace": "AMAZON", "orders": 3, "units": 5, "totalAmount": 75000.00}]
                        }""", MediaType.APPLICATION_JSON));

        SalesByMarketplaceReport report =
                gateway.salesByMarketplace(new ReportPeriod(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31")));

        assertThat(report.from()).isEqualTo(LocalDate.parse("2026-10-01"));
        assertThat(report.to()).isEqualTo(LocalDate.parse("2026-10-31"));
        assertThat(report.marketplaces()).singleElement().satisfies(sales -> {
            assertThat(sales.marketplace()).isEqualTo(Marketplace.AMAZON);
            assertThat(sales.orders()).isEqualTo(3);
            assertThat(sales.units()).isEqualTo(5);
            assertThat(sales.totalAmount()).isEqualByComparingTo("75000.00");
        });
    }

    @Test
    void failsWhenTheOrderServiceReturnsAMarketplaceTheBffDoesNotKnow() {
        server.expect(requestTo(BASE_URL + "/orders/" + ORDER_ID))
                .andRespond(withSuccess(ORDER_JSON.replace("MERCADO_LIVRE", "ALIEXPRESS"), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> gateway.findById(UUID.fromString(ORDER_ID)))
                .isInstanceOf(DownstreamFailureException.class);
    }

    @Test
    void failsWhenTheOrderServiceIsUnavailable() {
        server.expect(requestTo(BASE_URL + "/orders?limit=20&offset=0"))
                .andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> gateway.list(new OrderFilter(null, null), PageRequest.of(null, null)))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("order-service is unavailable");
    }

}
