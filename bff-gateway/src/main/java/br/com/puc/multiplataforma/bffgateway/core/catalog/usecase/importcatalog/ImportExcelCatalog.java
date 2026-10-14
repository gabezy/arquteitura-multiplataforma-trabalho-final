package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogGateway;
import br.com.puc.multiplataforma.bffgateway.core.catalog.gateway.CatalogSpreadsheetReader;

import java.io.InputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class ImportExcelCatalog {

    private final CatalogSpreadsheetReader spreadsheetReader;
    private final CatalogGateway catalogGateway;

    public ImportExcelCatalog(CatalogSpreadsheetReader spreadsheetReader, CatalogGateway catalogGateway) {
        this.spreadsheetReader = spreadsheetReader;
        this.catalogGateway = catalogGateway;
    }

    public ImportCatalogResult execute(InputStream spreadsheet) {
        List<NewProduct> newProducts = spreadsheetReader.read(spreadsheet);
        ensureNotEmpty(newProducts);
        ensureUniqueSkus(newProducts);

        catalogGateway.importProducts(newProducts);

        return new ImportCatalogResult(newProducts.size());
    }

    private static void ensureNotEmpty(List<NewProduct> newProducts) {
        if (newProducts.isEmpty()) {
            throw new InvalidCatalogException("spreadsheet has no products");
        }
    }

    private static void ensureUniqueSkus(List<NewProduct> newProducts) {
        Set<String> seenSkus = new HashSet<>();
        List<String> errors = newProducts.stream()
                .map(NewProduct::sku)
                .filter(sku -> !seenSkus.add(sku))
                .distinct()
                .map(sku -> "duplicated sku: " + sku)
                .toList();

        if (!errors.isEmpty()) {
            throw new InvalidCatalogException(errors);
        }
    }

}
