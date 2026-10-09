package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportCatalogResult;

public record ImportCatalogResponse(int importedProducts) {

    public static ImportCatalogResponse from(ImportCatalogResult result) {
        return new ImportCatalogResponse(result.importedProducts());
    }

}
