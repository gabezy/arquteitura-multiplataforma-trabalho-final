package br.com.puc.multiplataforma.bffgateway.infra.catalog.config;

import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogSpreadsheetReader;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.ProductPriceGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.changeprice.ChangeProductPrice;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.CatalogGatewayMapper;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.CatalogGatewayMapperImpl;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.CatalogServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.spreadsheet.PoiCatalogSpreadsheetReader;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CatalogConfig {

    @Bean
    public CatalogSpreadsheetReader catalogSpreadsheetReader() {
        return new PoiCatalogSpreadsheetReader();
    }

    @Bean
    public CatalogGatewayMapper catalogGatewayMapper() {
        return new CatalogGatewayMapperImpl();
    }

    @Bean
    public CatalogServiceClientGateway catalogServiceClientGateway(DownstreamClientFactory downstreamClients,
                                                                   CatalogGatewayMapper mapper,
                                                                   @Value("${catalog-service.url}") String catalogServiceUrl) {
        return new CatalogServiceClientGateway(downstreamClients.create("catalog-service", catalogServiceUrl), mapper);
    }

    @Bean
    public ImportExcelCatalog importExcelCatalog(CatalogSpreadsheetReader catalogSpreadsheetReader,
                                                 CatalogGateway catalogGateway) {
        return new ImportExcelCatalog(catalogSpreadsheetReader, catalogGateway);
    }

    @Bean
    public ChangeProductPrice changeProductPrice(ProductPriceGateway productPriceGateway) {
        return new ChangeProductPrice(productPriceGateway);
    }

}
