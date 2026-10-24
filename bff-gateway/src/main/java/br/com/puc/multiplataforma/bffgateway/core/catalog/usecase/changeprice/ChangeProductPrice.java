package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.changeprice;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.PriceChange;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.ProductPriceGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;

import java.math.BigDecimal;

public class ChangeProductPrice {

    private final ProductPriceGateway productPriceGateway;

    public ChangeProductPrice(ProductPriceGateway productPriceGateway) {
        this.productPriceGateway = productPriceGateway;
    }

    public void execute(String sku, BigDecimal price) {
        if (!productPriceGateway.changePrice(new PriceChange(sku, price))) {
            throw new ResourceNotFoundException("product", sku);
        }
    }

}
