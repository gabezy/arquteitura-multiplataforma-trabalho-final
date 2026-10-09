package br.com.puc.multiplataforma.bffgateway.infra.catalog.config;

import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogSpreadsheetReader;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.CatalogServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.spreadsheet.PoiCatalogSpreadsheetReader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class CatalogConfig {

    @Bean
    public CatalogSpreadsheetReader catalogSpreadsheetReader() {
        return new PoiCatalogSpreadsheetReader();
    }

    @Bean
    public CatalogGateway catalogGateway(RestClient.Builder builder,
                                         @Value("${catalog-service.url:http://localhost:8089}") String catalogServiceUrl) {
        return new CatalogServiceClientGateway(builder, catalogServiceUrl);
    }

    @Bean
    public ImportExcelCatalog importExcelCatalog(CatalogSpreadsheetReader catalogSpreadsheetReader,
                                                 CatalogGateway catalogGateway) {
        return new ImportExcelCatalog(catalogSpreadsheetReader, catalogGateway);
    }

}
