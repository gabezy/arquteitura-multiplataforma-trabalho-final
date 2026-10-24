package br.com.puc.multiplataforma.bffgateway.core.order.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

public record OrderFilter(Marketplace marketplace, OrderStatus status) {
}
