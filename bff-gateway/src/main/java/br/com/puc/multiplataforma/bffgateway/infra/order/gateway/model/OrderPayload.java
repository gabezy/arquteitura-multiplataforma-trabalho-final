package br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderPayload(
        UUID id,
        Marketplace marketplace,
        String externalOrderId,
        OrderStatus status,
        BigDecimal total,
        List<OrderItemPayload> items,
        String cancellationReason,
        Instant createdAt,
        Instant updatedAt
) {

    public Order toDomain() {
        return new Order(
                id,
                marketplace,
                externalOrderId,
                status,
                total,
                Objects.requireNonNullElse(items, List.<OrderItemPayload>of()).stream().map(OrderItemPayload::toDomain).toList(),
                cancellationReason,
                createdAt,
                updatedAt
        );
    }

}
