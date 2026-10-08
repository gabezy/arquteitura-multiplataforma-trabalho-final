package br.com.puc.multiplataforma.bffgateway.core.catalog.usecase;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;
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
        List<Product> products = spreadsheetReader.read(spreadsheet);
        ensureNotEmpty(products);
        ensureUniqueSkus(products);

        catalogGateway.importProducts(products);

        return new ImportCatalogResult(products.size());
    }

    private static void ensureNotEmpty(List<Product> products) {
        if (products.isEmpty()) {
            throw new InvalidCatalogException("spreadsheet has no products");
        }
    }

    private static void ensureUniqueSkus(List<Product> products) {
        Set<String> seenSkus = new HashSet<>();
        List<String> errors = products.stream()
                .map(Product::sku)
                .filter(sku -> !seenSkus.add(sku))
                .distinct()
                .map(sku -> "duplicated sku: " + sku)
                .toList();

        if (!errors.isEmpty()) {
            throw new InvalidCatalogException(errors);
        }
    }

}
