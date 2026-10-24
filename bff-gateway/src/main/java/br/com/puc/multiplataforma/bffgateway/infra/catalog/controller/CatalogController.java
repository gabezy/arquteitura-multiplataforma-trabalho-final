package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller;

import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.changeprice.ChangeProductPrice;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.controller.dto.ChangePriceRequest;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.controller.dto.ImportCatalogResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;

@RestController
@RequestMapping(path = "/catalog", produces = MediaType.APPLICATION_JSON_VALUE)
public class CatalogController {

    private final ImportExcelCatalog importExcelCatalog;
    private final ChangeProductPrice changeProductPrice;

    public CatalogController(ImportExcelCatalog importExcelCatalog, ChangeProductPrice changeProductPrice) {
        this.importExcelCatalog = importExcelCatalog;
        this.changeProductPrice = changeProductPrice;
    }

    @PostMapping(path = "/import/xlsx", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('admin', 'store') or hasAuthority('SCOPE_catalog:write')")
    public ResponseEntity<ImportCatalogResponse> importCatalog(@RequestPart("file") MultipartFile file) throws IOException {
        try (InputStream spreadsheet = file.getInputStream()) {
            return ResponseEntity.ok(ImportCatalogResponse.from(importExcelCatalog.execute(spreadsheet)));
        }
    }

    @PatchMapping(path = "/products/{sku}/price", consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAnyRole('admin', 'store') or hasAuthority('SCOPE_catalog:write')")
    public ResponseEntity<Void> changePrice(@PathVariable String sku, @RequestBody ChangePriceRequest request) {
        changeProductPrice.execute(sku, request.price());
        return ResponseEntity.noContent().build();
    }

}
