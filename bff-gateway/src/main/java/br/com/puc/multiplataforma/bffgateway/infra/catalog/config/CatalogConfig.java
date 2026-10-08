package br.com.puc.multiplataforma.bffgateway.infra.catalog.config;

import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogSpreadsheetReader;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway.MockCatalogGateway;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.spreadsheet.PoiCatalogSpreadsheetReader;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CatalogConfig {

    @Bean
    public CatalogSpreadsheetReader catalogSpreadsheetReader() {
        return new PoiCatalogSpreadsheetReader();
    }

    @Bean
    public CatalogGateway catalogGateway() {
        return new MockCatalogGateway();
    }

    @Bean
    public ImportExcelCatalog importExcelCatalog(CatalogSpreadsheetReader catalogSpreadsheetReader,
                                                 CatalogGateway catalogGateway) {
        return new ImportExcelCatalog(catalogSpreadsheetReader, catalogGateway);
    }

}
