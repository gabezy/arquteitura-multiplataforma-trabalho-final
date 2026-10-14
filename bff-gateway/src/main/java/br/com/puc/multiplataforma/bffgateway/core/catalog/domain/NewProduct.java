package br.com.puc.multiplataforma.bffgateway.core.catalog.domain;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;

import java.math.BigDecimal;

public record NewProduct(String sku, String name, String description, BigDecimal price, int stock) {

    public NewProduct {
        requireText(sku, "sku");
        requireText(name, "name");
        if (price == null) {
            throw new InvalidProductException("price is required");
        }
        if (price.signum() < 0) {
            throw new InvalidProductException("price must not be negative");
        }
        if (stock < 0) {
            throw new InvalidProductException("stock must not be negative");
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new InvalidProductException(field + " is required");
        }
    }

}
