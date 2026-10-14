package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.model.ImportProducts;

import java.util.List;

public class CatalogGatewayMapperImpl implements CatalogGatewayMapper {

    @Override
    public ImportProducts toImportProducts(List<NewProduct> newProducts) {
        var productImport = newProducts.stream()
                .map(product -> new ImportProducts.Product(
                        product.sku(),
                        product.name(),
                        product.description(),
                        product.price().doubleValue(),
                        product.stock()
                ))
                .toList();

        return new ImportProducts(productImport);
    }
}
