package br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderResponse(
        UUID id,
        Marketplace marketplace,
        String externalOrderId,
        OrderStatus status,
        BigDecimal total,
        List<OrderItemResponse> items,
        String cancellationReason,
        Instant createdAt,
        Instant updatedAt
) {

    public static OrderResponse from(Order order) {
        return new OrderResponse(
                order.id(),
                order.marketplace(),
                order.externalOrderId(),
                order.status(),
                order.total(),
                order.items().stream().map(OrderItemResponse::from).toList(),
                order.cancellationReason(),
                order.createdAt(),
                order.updatedAt()
        );
    }

}
