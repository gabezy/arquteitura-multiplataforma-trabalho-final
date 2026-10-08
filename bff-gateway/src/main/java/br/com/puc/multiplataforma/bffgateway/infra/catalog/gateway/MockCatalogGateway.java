package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Stand-in for the catalog service until its REST API exists; replace with a RestClient-based implementation.
 */
public class MockCatalogGateway implements CatalogGateway {

    private static final Logger log = LoggerFactory.getLogger(MockCatalogGateway.class);

    @Override
    public void importProducts(List<Product> products) {
        log.info("Mock catalog service: received {} products to import", products.size());
    }

}
