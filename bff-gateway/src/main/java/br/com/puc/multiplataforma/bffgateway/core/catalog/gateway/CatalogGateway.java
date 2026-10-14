package br.com.puc.multiplataforma.bffgateway.core.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;

import java.util.List;

public interface CatalogGateway {

    void importProducts(List<NewProduct> newProducts);

}
