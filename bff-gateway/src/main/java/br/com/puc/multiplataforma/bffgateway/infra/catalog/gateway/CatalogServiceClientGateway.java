package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.PriceChange;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.ProductPriceGateway;
import br.com.puc.multiplataforma.bffgateway.infra.cache.CacheNames;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.model.PriceUpdate;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.CacheEvict;

import java.util.List;

public class CatalogServiceClientGateway implements CatalogGateway, ProductPriceGateway {

    private static final Logger log = LoggerFactory.getLogger(CatalogServiceClientGateway.class);

    private final DownstreamClient catalogService;
    private final CatalogGatewayMapper mapper;

    public CatalogServiceClientGateway(DownstreamClient catalogService, CatalogGatewayMapper mapper) {
        this.catalogService = catalogService;
        this.mapper = mapper;
    }

    @Override
    public void importProducts(List<NewProduct> newProducts) {
        log.info("Importing products: {}", newProducts.size());

        catalogService.post(uri -> uri.path("/products/import").build(), mapper.toImportProducts(newProducts));
    }

    @Override
    @CacheEvict(cacheNames = {CacheNames.LISTINGS, CacheNames.LISTING}, allEntries = true)
    public boolean changePrice(PriceChange priceChange) {
        log.info("Changing price of product {}", priceChange.sku());

        return catalogService.patch(uri -> uri.path("/products/sku/{sku}/price").build(priceChange.sku()),
                new PriceUpdate(priceChange.price()));
    }

}
