package br.com.puc.multiplataforma.bffgateway.core.order.gateway;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.util.Optional;
import java.util.UUID;

public interface OrderGateway {

    Page<Order> list(OrderFilter filter, PageRequest pageRequest);

    Optional<Order> findById(UUID id);

    SalesByMarketplaceReport salesByMarketplace(ReportPeriod period);

}
