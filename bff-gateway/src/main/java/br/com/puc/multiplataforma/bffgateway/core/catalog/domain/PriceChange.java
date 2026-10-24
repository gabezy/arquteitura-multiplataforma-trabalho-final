package br.com.puc.multiplataforma.bffgateway.core.catalog.domain;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;

import java.math.BigDecimal;

public record PriceChange(String sku, BigDecimal price) {

    public PriceChange {
        if (sku == null || sku.isBlank()) {
            throw new InvalidProductException("sku is required");
        }
        if (price == null) {
            throw new InvalidProductException("price is required");
        }
        if (price.signum() < 0) {
            throw new InvalidProductException("price must not be negative");
        }
    }

}
