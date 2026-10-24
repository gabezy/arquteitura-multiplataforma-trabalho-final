package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import java.math.BigDecimal;

public record OrderItem(String sku, int quantity, BigDecimal unitPrice) {
}
