package br.com.puc.multiplataforma.bffgateway.core.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.Product;

import java.io.InputStream;
import java.util.List;

public interface CatalogSpreadsheetReader {

    List<Product> read(InputStream spreadsheet);

}
