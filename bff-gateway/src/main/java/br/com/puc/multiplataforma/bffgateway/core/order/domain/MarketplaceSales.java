package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;

public record MarketplaceSales(Marketplace marketplace, long orders, long units, BigDecimal totalAmount) {
}
