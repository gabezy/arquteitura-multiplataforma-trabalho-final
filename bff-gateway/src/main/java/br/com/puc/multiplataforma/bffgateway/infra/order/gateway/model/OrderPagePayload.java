package br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Objects;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderPagePayload(List<OrderPayload> orders, int limit, int offset) {

    public Page<Order> toDomain() {
        List<Order> items = Objects.requireNonNullElse(orders, List.<OrderPayload>of()).stream()
                .map(OrderPayload::toDomain)
                .toList();
        return new Page<>(items, limit, offset);
    }

}
