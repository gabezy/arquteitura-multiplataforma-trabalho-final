package br.com.puc.multiplataforma.bffgateway.core.billing.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.util.UUID;

public record InvoiceFilter(UUID orderId, InvoiceStatus status, Marketplace marketplace) {
}
