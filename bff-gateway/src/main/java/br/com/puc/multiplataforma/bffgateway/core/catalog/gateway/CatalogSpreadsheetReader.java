package br.com.puc.multiplataforma.bffgateway.core.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;

import java.io.InputStream;
import java.util.List;

public interface CatalogSpreadsheetReader {

    List<NewProduct> read(InputStream spreadsheet);

}
