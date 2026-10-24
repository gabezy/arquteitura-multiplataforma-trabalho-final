package br.com.puc.multiplataforma.bffgateway.infra;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceItem;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.MockBillingGateway;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.MockMarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.MockOrderGateway;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class MockDemoDataConsistencyTest {

    private static final PageRequest EVERYTHING = new PageRequest(100, 0);

    private final MockOrderGateway orders = new MockOrderGateway();
    private final MockBillingGateway billing = new MockBillingGateway();
    private final MockMarketplaceGateway marketplace = new MockMarketplaceGateway();

    @Test
    void everyMockInvoiceBelongsToAMockOrderWithTheSameMarketplaceItemsAndAmount() {
        List<Invoice> invoices = billing.list(new InvoiceFilter(null, null, null), EVERYTHING).items();

        assertThat(invoices).allSatisfy(invoice -> assertThat(orders.findById(invoice.orderId())).hasValueSatisfying(order -> {
            assertThat(invoice.marketplace()).isEqualTo(order.marketplace());
            assertThat(invoice.externalOrderId()).isEqualTo(order.externalOrderId());
            assertThat(invoice.amount()).isEqualByComparingTo(order.total());
            assertThat(invoice.items()).extracting(InvoiceItem::sku, InvoiceItem::quantity)
                    .containsExactlyElementsOf(skusAndQuantities(order));
        }));
    }

    @Test
    void theStatusOfEveryMockInvoiceMatchesTheStatusOfItsOrder() {
        List<Invoice> invoices = billing.list(new InvoiceFilter(null, null, null), EVERYTHING).items();

        assertThat(invoices).allSatisfy(invoice -> {
            Order order = orders.findById(invoice.orderId()).orElseThrow();
            switch (invoice.status()) {
                case ISSUED, PAYMENT_PENDING -> assertThat(order.status()).isEqualTo(OrderStatus.CONFIRMED);
                case PAID -> assertThat(order.status()).isEqualTo(OrderStatus.PAID);
                case PAYMENT_FAILED -> {
                    assertThat(order.status()).isEqualTo(OrderStatus.CANCELLED);
                    assertThat(order.cancellationReason()).isEqualTo("PAYMENT_FAILED");
                }
                case CANCELLED -> {
                    assertThat(order.status()).isEqualTo(OrderStatus.CANCELLED);
                    assertThat(order.cancellationReason()).isEqualTo(invoice.cancellationReason());
                }
            }
        });
    }

    @Test
    void everyMockListingIsForAProductThatTheMockOrdersSellAtTheSamePrice() {
        List<Listing> listings = marketplace.list(new ListingFilter(null, null, null), EVERYTHING).items();
        List<OrderItem> soldItems = orders.list(new OrderFilter(null, null), EVERYTHING).items().stream()
                .flatMap(order -> order.items().stream())
                .toList();

        assertThat(listings).allSatisfy(listing -> assertThat(soldItems)
                .filteredOn(item -> item.sku().equals(listing.sku()))
                .isNotEmpty()
                .allSatisfy(item -> assertThat(item.unitPrice()).isEqualByComparingTo(listing.price())));
    }

    private static List<Tuple> skusAndQuantities(Order order) {
        return order.items().stream().map(item -> tuple(item.sku(), item.quantity())).toList();
    }

}
