package br.com.puc.multiplataforma.bffgateway.core.order;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class OrderFixtures {

    public static final UUID ORDER_ID = UUID.fromString("6f1c2b8e-0000-4000-8000-000000000001");

    private OrderFixtures() {
    }

    public static Order order() {
        return new Order(
                ORDER_ID,
                Marketplace.MERCADO_LIVRE,
                "ML-2000001",
                OrderStatus.PAID,
                new BigDecimal("18500.00"),
                List.of(new OrderItem("MON-002", 1, new BigDecimal("18500.00"))),
                null,
                Instant.parse("2026-10-28T13:05:00Z"),
                Instant.parse("2026-10-28T13:05:06Z")
        );
    }

}
