package br.com.puc.multiplataforma.bffgateway.core.marketplace.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

public record ListingFilter(String sku, Marketplace marketplace, ListingStatus status) {

    public ListingFilter {
        sku = sku == null || sku.isBlank() ? null : sku.trim();
    }

}
