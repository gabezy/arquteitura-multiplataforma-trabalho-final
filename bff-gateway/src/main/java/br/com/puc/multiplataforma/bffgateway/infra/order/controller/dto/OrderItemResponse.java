package br.com.puc.multiplataforma.bffgateway.infra.order.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderItem;

import java.math.BigDecimal;

public record OrderItemResponse(String sku, int quantity, BigDecimal unitPrice) {

    public static OrderItemResponse from(OrderItem item) {
        return new OrderItemResponse(item.sku(), item.quantity(), item.unitPrice());
    }

}
