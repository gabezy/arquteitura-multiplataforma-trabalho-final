package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.model;

import java.util.List;

public record ImportProducts(
    List<Product> items
) {
    public record Product(
            String sku,
            String name,
            String description,
            double price,
            int stock
    ) {}
}
