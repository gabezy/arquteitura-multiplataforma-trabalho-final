package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.infra.security.AuthenticatedUserHeaderInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;

import java.util.List;

public class CatalogServiceClientGateway implements CatalogGateway {

    private static final Logger log = LoggerFactory.getLogger(CatalogServiceClientGateway.class);

    private final RestClient restClient;

    public CatalogServiceClientGateway(RestClient.Builder builder, String catalogServiceUrl) {
        this.restClient = builder
                .baseUrl(catalogServiceUrl)
                .requestInterceptor(new AuthenticatedUserHeaderInterceptor())
                .build();
    }

    @Override
    public void importProducts(List<Product> products) {
        log.info("Importing products: {}", products.size());

        restClient
                .post()
                .uri("/catalog/products")
                .body(products)
                .retrieve()
                .toBodilessEntity();
    }

}
