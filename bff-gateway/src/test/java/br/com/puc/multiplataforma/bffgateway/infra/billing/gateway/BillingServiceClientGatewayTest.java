package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class BillingServiceClientGatewayTest {

    private static final String BASE_URL = "http://billing-service:8086";
    private static final String INVOICE_ID = "1d7e3a10-0000-4000-8000-000000000002";
    private static final String ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000002";
    private static final String INVOICE_JSON = """
            {
              "id": "1d7e3a10-0000-4000-8000-000000000002",
              "orderId": "6f1c2b8e-0000-4000-8000-000000000002",
              "externalOrderId": "AMZ-1000001",
              "marketplace": "AMAZON",
              "status": "PAYMENT_FAILED",
              "amount": 111000.00,
              "commissionPercent": 12.00,
              "commissionAmount": 13320.00,
              "netAmount": 97680.00,
              "items": [{"sku": "MON-002", "quantity": 6, "unitPrice": 18500.00, "amount": 111000.00}],
              "issuedAt": "2026-10-28T13:10:03Z",
              "cancelledAt": null,
              "cancellationReason": null,
              "pspTransactionId": "ch_failed_1d7e3a10-0000-4000-8000-000000000002",
              "failureReason": "INSUFFICIENT_FUNDS",
              "paidAt": null,
              "failedAt": "2026-10-28T13:10:06Z",
              "somethingNew": "fields the BFF does not know are ignored"
            }""";

    private final RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final BillingServiceClientGateway gateway =
            new BillingServiceClientGateway(new DownstreamClient("billing-service", builder.build()));

    @Test
    void listsInvoicesWithTheFiltersAndThePagination() {
        server.expect(requestTo(BASE_URL + "/invoices?orderId=" + ORDER_ID + "&status=PAYMENT_FAILED&marketplace=AMAZON&limit=5&offset=10"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {"invoices": [%s], "limit": 5, "offset": 10}""".formatted(INVOICE_JSON), MediaType.APPLICATION_JSON));

        Page<Invoice> page = gateway.list(
                new InvoiceFilter(UUID.fromString(ORDER_ID), InvoiceStatus.PAYMENT_FAILED, Marketplace.AMAZON),
                new PageRequest(5, 10));

        assertThat(page.limit()).isEqualTo(5);
        assertThat(page.offset()).isEqualTo(10);
        assertThat(page.items()).singleElement().satisfies(invoice -> {
            assertThat(invoice.id()).isEqualTo(UUID.fromString(INVOICE_ID));
            assertThat(invoice.orderId()).isEqualTo(UUID.fromString(ORDER_ID));
            assertThat(invoice.externalOrderId()).isEqualTo("AMZ-1000001");
            assertThat(invoice.marketplace()).isEqualTo(Marketplace.AMAZON);
            assertThat(invoice.status()).isEqualTo(InvoiceStatus.PAYMENT_FAILED);
            assertThat(invoice.amount()).isEqualByComparingTo("111000.00");
            assertThat(invoice.commissionPercent()).isEqualByComparingTo("12.00");
            assertThat(invoice.commissionAmount()).isEqualByComparingTo("13320.00");
            assertThat(invoice.netAmount()).isEqualByComparingTo("97680.00");
            assertThat(invoice.items()).extracting(InvoiceItem::sku, InvoiceItem::quantity).containsExactly(tuple("MON-002", 6));
            assertThat(invoice.items().getFirst().unitPrice()).isEqualByComparingTo("18500.00");
            assertThat(invoice.items().getFirst().amount()).isEqualByComparingTo("111000.00");
            assertThat(invoice.issuedAt()).isEqualTo(Instant.parse("2026-10-28T13:10:03Z"));
            assertThat(invoice.cancelledAt()).isNull();
            assertThat(invoice.cancellationReason()).isNull();
            assertThat(invoice.pspTransactionId()).isEqualTo("ch_failed_" + INVOICE_ID);
            assertThat(invoice.failureReason()).isEqualTo("INSUFFICIENT_FUNDS");
            assertThat(invoice.paidAt()).isNull();
            assertThat(invoice.failedAt()).isEqualTo(Instant.parse("2026-10-28T13:10:06Z"));
        });
        server.verify();
    }

    @Test
    void omitsTheFiltersThatWereNotInformed() {
        server.expect(requestTo(BASE_URL + "/invoices?limit=20&offset=0"))
                .andRespond(withSuccess("{\"invoices\": [], \"limit\": 20, \"offset\": 0}", MediaType.APPLICATION_JSON));

        Page<Invoice> page = gateway.list(new InvoiceFilter(null, null, null), PageRequest.of(null, null));

        assertThat(page.items()).isEmpty();
        server.verify();
    }

    @Test
    void treatsMissingListsAsEmpty() {
        server.expect(requestTo(BASE_URL + "/invoices?limit=20&offset=0"))
                .andRespond(withSuccess("""
                        {"invoices": [{"id": "1d7e3a10-0000-4000-8000-000000000002", "status": "ISSUED"}], "limit": 20, "offset": 0}""",
                        MediaType.APPLICATION_JSON));

        Page<Invoice> page = gateway.list(new InvoiceFilter(null, null, null), PageRequest.of(null, null));

        assertThat(page.items()).singleElement().satisfies(invoice -> assertThat(invoice.items()).isEmpty());
    }

    @Test
    void findsAnInvoiceById() {
        server.expect(requestTo(BASE_URL + "/invoices/" + INVOICE_ID))
                .andRespond(withSuccess(INVOICE_JSON, MediaType.APPLICATION_JSON));

        assertThat(gateway.findById(UUID.fromString(INVOICE_ID)))
                .hasValueSatisfying(invoice -> assertThat(invoice.externalOrderId()).isEqualTo("AMZ-1000001"));
        server.verify();
    }

    @Test
    void findsNothingWhenTheBillingServiceDoesNotKnowTheInvoice() {
        server.expect(requestTo(BASE_URL + "/invoices/" + INVOICE_ID)).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(gateway.findById(UUID.fromString(INVOICE_ID))).isEmpty();
    }

    @Test
    void failsWhenTheBillingServiceReturnsAStatusTheBffDoesNotKnow() {
        server.expect(requestTo(BASE_URL + "/invoices/" + INVOICE_ID))
                .andRespond(withSuccess(INVOICE_JSON.replace("PAYMENT_FAILED", "REFUNDED"), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> gateway.findById(UUID.fromString(INVOICE_ID)))
                .isInstanceOf(DownstreamFailureException.class);
    }

    @Test
    void failsWhenTheBillingServiceIsUnavailable() {
        server.expect(requestTo(BASE_URL + "/invoices?limit=20&offset=0"))
                .andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> gateway.list(new InvoiceFilter(null, null, null), PageRequest.of(null, null)))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("billing-service is unavailable");
    }

}
