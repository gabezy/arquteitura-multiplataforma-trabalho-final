package br.com.puc.multiplataforma.bffgateway.infra.order.gateway;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class MockOrderGatewayTest {

    private static final OrderFilter NO_FILTER = new OrderFilter(null, null);

    private final MockOrderGateway gateway = new MockOrderGateway();

    @Test
    void listsTheMostRecentOrdersFirst() {
        Page<Order> page = gateway.list(NO_FILTER, PageRequest.of(null, null));

        assertThat(page.items()).hasSize(8);
        assertThat(page.items()).extracting(Order::createdAt).isSortedAccordingTo(Comparator.reverseOrder());
        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.offset()).isZero();
    }

    @Test
    void filtersByMarketplace() {
        Page<Order> page = gateway.list(new OrderFilter(Marketplace.AMAZON, null), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Order::externalOrderId).containsExactly("AMZ-1000001", "AMZ-1000002");
    }

    @Test
    void filtersByStatus() {
        Page<Order> page = gateway.list(new OrderFilter(null, OrderStatus.CANCELLED), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Order::cancellationReason)
                .containsExactly("PAYMENT_FAILED", "OUT_OF_STOCK", "MARKETPLACE_CANCELLED");
    }

    @Test
    void combinesTheFilters() {
        Page<Order> page = gateway.list(new OrderFilter(Marketplace.SHOPEE, OrderStatus.CONFIRMED), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Order::externalOrderId).containsExactly("SP-3000003", "SP-3000001");
    }

    @Test
    void paginatesWithLimitAndOffset() {
        Page<Order> all = gateway.list(NO_FILTER, PageRequest.of(null, null));

        Page<Order> page = gateway.list(NO_FILTER, new PageRequest(3, 2));

        assertThat(page.items()).containsExactlyElementsOf(all.items().subList(2, 5));
        assertThat(page.limit()).isEqualTo(3);
        assertThat(page.offset()).isEqualTo(2);
    }

    @Test
    void returnsAnEmptyPageBeyondTheLastOrder() {
        Page<Order> page = gateway.list(NO_FILTER, new PageRequest(20, 8));

        assertThat(page.items()).isEmpty();
    }

    @Test
    void findsAnOrderById() {
        UUID id = UUID.fromString("6f1c2b8e-0000-4000-8000-000000000001");

        assertThat(gateway.findById(id)).hasValueSatisfying(order -> {
            assertThat(order.externalOrderId()).isEqualTo("ML-2000001");
            assertThat(order.total()).isEqualByComparingTo("18500.00");
            assertThat(order.items()).extracting(OrderItem::sku, OrderItem::quantity).containsExactly(tuple("MON-002", 1));
        });
    }

    @Test
    void returnsNothingForAnUnknownId() {
        assertThat(gateway.findById(UUID.fromString("6f1c2b8e-0000-4000-8000-0000000000ff"))).isEmpty();
    }

    @Test
    void sumsTheSalesByMarketplaceIgnoringReceivedAndCancelledOrders() {
        var report = gateway.salesByMarketplace(new ReportPeriod(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31")));

        assertThat(report.from()).isEqualTo(LocalDate.parse("2026-10-01"));
        assertThat(report.to()).isEqualTo(LocalDate.parse("2026-10-31"));
        assertThat(report.marketplaces())
                .extracting(MarketplaceSales::marketplace, MarketplaceSales::orders, MarketplaceSales::units)
                .containsExactly(
                        tuple(Marketplace.AMAZON, 1L, 2L),
                        tuple(Marketplace.MERCADO_LIVRE, 1L, 1L),
                        tuple(Marketplace.SHOPEE, 2L, 3L));
        assertThat(report.marketplaces()).extracting(MarketplaceSales::totalAmount)
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactly(new BigDecimal("18689.90"), new BigDecimal("18500.00"), new BigDecimal("18879.80"));
    }

    @Test
    void limitsTheReportToThePeriod() {
        var report = gateway.salesByMarketplace(new ReportPeriod(LocalDate.parse("2026-10-28"), LocalDate.parse("2026-10-28")));

        assertThat(report.marketplaces())
                .extracting(MarketplaceSales::marketplace, MarketplaceSales::orders)
                .containsExactly(tuple(Marketplace.MERCADO_LIVRE, 1L), tuple(Marketplace.SHOPEE, 1L));
    }

    @Test
    void reportsNoMarketplacesWhenThereAreNoSalesInThePeriod() {
        var report = gateway.salesByMarketplace(new ReportPeriod(LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-30")));

        assertThat(report.marketplaces()).isEmpty();
    }

}
