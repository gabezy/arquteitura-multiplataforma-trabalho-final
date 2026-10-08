package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller;

import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.catalog.controller.dto.ImportCatalogResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
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

    public CatalogController(ImportExcelCatalog importExcelCatalog) {
        this.importExcelCatalog = importExcelCatalog;
    }

    @PostMapping(path = "/import/xlsx", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('admin') or hasAuthority('SCOPE_catalog:write')")
    public ResponseEntity<ImportCatalogResponse> importCatalog(@RequestPart("file") MultipartFile file) throws IOException {
        try (InputStream spreadsheet = file.getInputStream()) {
            return ResponseEntity.ok(ImportCatalogResponse.from(importExcelCatalog.execute(spreadsheet)));
        }
    }

}
