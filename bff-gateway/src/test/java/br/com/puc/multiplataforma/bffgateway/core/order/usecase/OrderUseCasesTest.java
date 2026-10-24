package br.com.puc.multiplataforma.bffgateway.core.order.usecase;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static br.com.puc.multiplataforma.bffgateway.core.order.OrderFixtures.ORDER_ID;
import static br.com.puc.multiplataforma.bffgateway.core.order.OrderFixtures.order;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

class OrderUseCasesTest {

    private final OrderGateway orderGateway = mock(OrderGateway.class);

    @Test
    void listsTheOrdersOfThePageRequestedFromTheGateway() {
        OrderFilter filter = new OrderFilter(Marketplace.AMAZON, OrderStatus.PAID);
        PageRequest pageRequest = new PageRequest(5, 10);
        Page<Order> page = new Page<>(List.of(order()), 5, 10);
        given(orderGateway.list(filter, pageRequest)).willReturn(page);

        Page<Order> result = new ListOrders(orderGateway).execute(filter, pageRequest);

        assertThat(result).isSameAs(page);
    }

    @Test
    void returnsTheOrderFoundByTheGateway() {
        given(orderGateway.findById(ORDER_ID)).willReturn(Optional.of(order()));

        Order result = new GetOrder(orderGateway).execute(ORDER_ID);

        assertThat(result).isEqualTo(order());
    }

    @Test
    void failsWhenTheOrderDoesNotExist() {
        UUID unknownId = UUID.fromString("6f1c2b8e-0000-4000-8000-0000000000ff");
        given(orderGateway.findById(unknownId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> new GetOrder(orderGateway).execute(unknownId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("order '6f1c2b8e-0000-4000-8000-0000000000ff' not found");
    }

    @Test
    void returnsTheSalesReportOfThePeriodFromTheGateway() {
        ReportPeriod period = new ReportPeriod(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"));
        SalesByMarketplaceReport report = new SalesByMarketplaceReport(period.from(), period.to(),
                List.of(new MarketplaceSales(Marketplace.AMAZON, 3, 5, new BigDecimal("75000.00"))));
        given(orderGateway.salesByMarketplace(period)).willReturn(report);

        SalesByMarketplaceReport result = new GetSalesByMarketplace(orderGateway).execute(period);

        assertThat(result).isSameAs(report);
    }

}
