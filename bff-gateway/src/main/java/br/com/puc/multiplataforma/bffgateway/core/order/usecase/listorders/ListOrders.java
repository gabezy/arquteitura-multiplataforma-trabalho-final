package br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

public class ListOrders {

    private final OrderGateway orderGateway;

    public ListOrders(OrderGateway orderGateway) {
        this.orderGateway = orderGateway;
    }

    public Page<Order> execute(OrderFilter filter, PageRequest pageRequest) {
        return orderGateway.list(filter, pageRequest);
    }

}
