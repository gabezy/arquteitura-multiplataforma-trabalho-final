package br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;

public class GetSalesByMarketplace {

    private final OrderGateway orderGateway;

    public GetSalesByMarketplace(OrderGateway orderGateway) {
        this.orderGateway = orderGateway;
    }

    public SalesByMarketplaceReport execute(ReportPeriod period) {
        return orderGateway.salesByMarketplace(period);
    }

}
