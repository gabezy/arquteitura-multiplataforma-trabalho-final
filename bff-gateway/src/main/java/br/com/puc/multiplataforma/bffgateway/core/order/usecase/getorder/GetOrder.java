package br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;

import java.util.UUID;

public class GetOrder {

    private final OrderGateway orderGateway;

    public GetOrder(OrderGateway orderGateway) {
        this.orderGateway = orderGateway;
    }

    public Order execute(UUID id) {
        return orderGateway.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("order", id));
    }

}
