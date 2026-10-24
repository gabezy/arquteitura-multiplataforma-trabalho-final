package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record Order(
        UUID id,
        Marketplace marketplace,
        String externalOrderId,
        OrderStatus status,
        BigDecimal total,
        List<OrderItem> items,
        String cancellationReason,
        Instant createdAt,
        Instant updatedAt
) {

    public Order {
        items = List.copyOf(items);
    }

}
