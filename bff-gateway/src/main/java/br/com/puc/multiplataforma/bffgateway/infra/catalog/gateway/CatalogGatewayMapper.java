package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.model.ImportProducts;

import java.util.List;

public interface CatalogGatewayMapper {

    ImportProducts toImportProducts(List<NewProduct> newProducts);

}
