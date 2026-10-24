package br.com.puc.multiplataforma.bffgateway.infra.order.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderItemPayload(String sku, int quantity, BigDecimal unitPrice) {

    public OrderItem toDomain() {
        return new OrderItem(sku, quantity, unitPrice);
    }

}
