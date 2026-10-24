package br.com.puc.multiplataforma.bffgateway.infra.order.gateway;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model.OrderPagePayload;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model.OrderPayload;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model.SalesReportPayload;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;

import java.util.Optional;
import java.util.UUID;

public class OrderServiceClientGateway implements OrderGateway {

    private final DownstreamClient orderService;

    public OrderServiceClientGateway(DownstreamClient orderService) {
        this.orderService = orderService;
    }

    @Override
    public Page<Order> list(OrderFilter filter, PageRequest pageRequest) {
        return orderService.get(uri -> uri
                        .path("/orders")
                        .queryParamIfPresent("marketplace", Optional.ofNullable(filter.marketplace()))
                        .queryParamIfPresent("status", Optional.ofNullable(filter.status()))
                        .queryParam("limit", pageRequest.limit())
                        .queryParam("offset", pageRequest.offset())
                        .build(),
                OrderPagePayload.class).toDomain();
    }

    @Override
    public Optional<Order> findById(UUID id) {
        return orderService.find(uri -> uri.path("/orders/{id}").build(id), OrderPayload.class)
                .map(OrderPayload::toDomain);
    }

    @Override
    public SalesByMarketplaceReport salesByMarketplace(ReportPeriod period) {
        return orderService.get(uri -> uri
                        .path("/reports/sales-by-marketplace")
                        .queryParam("from", period.from())
                        .queryParam("to", period.to())
                        .build(),
                SalesReportPayload.class).toDomain();
    }

}
