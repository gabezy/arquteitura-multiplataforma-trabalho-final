package br.com.puc.multiplataforma.bffgateway.infra.billing.gateway;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MockBillingGatewayTest {

    private static final InvoiceFilter NO_FILTER = new InvoiceFilter(null, null, null);

    private final MockBillingGateway gateway = new MockBillingGateway();

    @Test
    void listsTheMostRecentInvoicesFirst() {
        Page<Invoice> page = gateway.list(NO_FILTER, PageRequest.of(null, null));

        assertThat(page.items()).hasSize(6);
        assertThat(page.items()).extracting(Invoice::issuedAt).isSortedAccordingTo(Comparator.reverseOrder());
        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.offset()).isZero();
    }

    @Test
    void coversEveryInvoiceStatus() {
        List<Invoice> invoices = gateway.list(NO_FILTER, PageRequest.of(null, null)).items();

        assertThat(invoices).extracting(Invoice::status).containsExactlyInAnyOrder(
                InvoiceStatus.ISSUED, InvoiceStatus.PAYMENT_PENDING, InvoiceStatus.PAID, InvoiceStatus.PAID,
                InvoiceStatus.PAYMENT_FAILED, InvoiceStatus.CANCELLED);
    }

    @Test
    void filtersByOrder() {
        UUID orderId = UUID.fromString("6f1c2b8e-0000-4000-8000-000000000002");

        Page<Invoice> page = gateway.list(new InvoiceFilter(orderId, null, null), PageRequest.of(null, null));

        assertThat(page.items()).singleElement().satisfies(invoice -> {
            assertThat(invoice.orderId()).isEqualTo(orderId);
            assertThat(invoice.status()).isEqualTo(InvoiceStatus.PAYMENT_FAILED);
        });
    }

    @Test
    void filtersByStatus() {
        Page<Invoice> page = gateway.list(new InvoiceFilter(null, InvoiceStatus.PAID, null), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Invoice::externalOrderId).containsExactly("ML-2000001", "AMZ-1000002");
    }

    @Test
    void filtersByMarketplace() {
        Page<Invoice> page = gateway.list(new InvoiceFilter(null, null, Marketplace.SHOPEE), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Invoice::externalOrderId).containsExactly("SP-3000003", "SP-3000001");
    }

    @Test
    void combinesTheFilters() {
        Page<Invoice> page = gateway.list(new InvoiceFilter(null, InvoiceStatus.PAID, Marketplace.AMAZON), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Invoice::externalOrderId).containsExactly("AMZ-1000002");
    }

    @Test
    void paginatesWithLimitAndOffset() {
        Page<Invoice> all = gateway.list(NO_FILTER, PageRequest.of(null, null));

        Page<Invoice> page = gateway.list(NO_FILTER, new PageRequest(2, 3));

        assertThat(page.items()).containsExactlyElementsOf(all.items().subList(3, 5));
        assertThat(page.limit()).isEqualTo(2);
        assertThat(page.offset()).isEqualTo(3);
    }

    @Test
    void returnsAnEmptyPageBeyondTheLastInvoice() {
        assertThat(gateway.list(NO_FILTER, new PageRequest(20, 6)).items()).isEmpty();
    }

    @Test
    void findsAnInvoiceById() {
        UUID id = UUID.fromString("1d7e3a10-0000-4000-8000-000000000001");

        assertThat(gateway.findById(id)).hasValueSatisfying(invoice -> {
            assertThat(invoice.externalOrderId()).isEqualTo("ML-2000001");
            assertThat(invoice.amount()).isEqualByComparingTo("18500.00");
            assertThat(invoice.commissionPercent()).isEqualByComparingTo("11.00");
            assertThat(invoice.commissionAmount()).isEqualByComparingTo("2035.00");
            assertThat(invoice.netAmount()).isEqualByComparingTo("16465.00");
            assertThat(invoice.pspTransactionId()).isEqualTo("ch_paid_" + id);
        });
    }

    @Test
    void returnsNothingForAnUnknownId() {
        assertThat(gateway.findById(UUID.fromString("1d7e3a10-0000-4000-8000-0000000000ff"))).isEmpty();
    }

    @Test
    void chargesTheCommissionOfEachMarketplaceRoundedHalfUp() {
        List<Invoice> invoices = gateway.list(NO_FILTER, PageRequest.of(null, null)).items();

        assertThat(invoices).allSatisfy(invoice -> {
            BigDecimal percent = switch (invoice.marketplace()) {
                case AMAZON -> new BigDecimal("12");
                case MERCADO_LIVRE -> new BigDecimal("11");
                case SHOPEE -> new BigDecimal("14");
            };
            assertThat(invoice.commissionPercent()).isEqualByComparingTo(percent);
            assertThat(invoice.commissionAmount())
                    .isEqualByComparingTo(invoice.amount().multiply(percent).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP));
            assertThat(invoice.netAmount()).isEqualByComparingTo(invoice.amount().subtract(invoice.commissionAmount()));
        });
    }

    @Test
    void fillsOnlyTheFieldsOfTheOutcomeOfEachStatus() {
        List<Invoice> invoices = gateway.list(NO_FILTER, PageRequest.of(null, null)).items();

        assertThat(invoices).filteredOn(invoice -> invoice.status() == InvoiceStatus.PAID).allSatisfy(invoice -> {
            assertThat(invoice.paidAt()).isNotNull();
            assertThat(invoice.pspTransactionId()).startsWith("ch_paid_");
            assertThat(invoice.failedAt()).isNull();
            assertThat(invoice.cancelledAt()).isNull();
        });
        assertThat(invoices).filteredOn(invoice -> invoice.status() == InvoiceStatus.PAYMENT_FAILED).allSatisfy(invoice -> {
            assertThat(invoice.failedAt()).isNotNull();
            assertThat(invoice.failureReason()).isEqualTo("INSUFFICIENT_FUNDS");
            assertThat(invoice.pspTransactionId()).startsWith("ch_failed_");
            assertThat(invoice.paidAt()).isNull();
        });
        assertThat(invoices).filteredOn(invoice -> invoice.status() == InvoiceStatus.CANCELLED).allSatisfy(invoice -> {
            assertThat(invoice.cancelledAt()).isNotNull();
            assertThat(invoice.cancellationReason()).isEqualTo("MARKETPLACE_CANCELLED");
            assertThat(invoice.pspTransactionId()).isNull();
        });
        assertThat(invoices).filteredOn(invoice -> invoice.status() == InvoiceStatus.ISSUED).allSatisfy(invoice -> {
            assertThat(invoice.pspTransactionId()).isNull();
            assertThat(invoice.paidAt()).isNull();
            assertThat(invoice.failedAt()).isNull();
            assertThat(invoice.cancelledAt()).isNull();
        });
    }

}
