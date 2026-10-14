package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.infra.security.AuthenticatedUserHeaderInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;

import java.util.List;

public class CatalogServiceClientGateway implements CatalogGateway {

    private static final Logger log = LoggerFactory.getLogger(CatalogServiceClientGateway.class);

    private final RestClient restClient;
    private final CatalogGatewayMapper mapper;

    public CatalogServiceClientGateway(RestClient.Builder builder, CatalogGatewayMapper mapper,
                                       String catalogServiceUrl) {
        this.mapper = mapper;
        this.restClient = builder
                .baseUrl(catalogServiceUrl)
                .requestInterceptor(new AuthenticatedUserHeaderInterceptor())
                .build();
    }

    @Override
    public void importProducts(List<NewProduct> newProducts) {
        log.info("Importing products: {}", newProducts.size());

        restClient
                .post()
                .uri("/products/import")
                .body(mapper.toImportProducts(newProducts))
                .retrieve()
                .toBodilessEntity();
    }

}
