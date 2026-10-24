package br.com.puc.multiplataforma.bffgateway.core.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.PriceChange;

public interface ProductPriceGateway {

    boolean changePrice(PriceChange priceChange);

}
