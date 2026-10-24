package br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;

import java.util.List;

public record OrderPageResponse(List<OrderResponse> orders, int limit, int offset) {

    public static OrderPageResponse from(Page<Order> page) {
        return new OrderPageResponse(
                page.items().stream().map(OrderResponse::from).toList(),
                page.limit(),
                page.offset()
        );
    }

}
