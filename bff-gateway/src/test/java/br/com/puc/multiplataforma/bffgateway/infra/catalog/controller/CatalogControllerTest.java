package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportCatalogResult;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(CatalogController.class)
@Import(SecurityConfig.class)
class CatalogControllerTest {

    private static final String IMPORT_CATALOG_ENDPOINT = "/catalog/import/xlsx";
    private static final MockMultipartFile SPREADSHEET =
            new MockMultipartFile("file", "catalog.xlsx", null, new byte[]{1});

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ImportExcelCatalog importExcelCatalog;

    @Test
    void returnsNumberOfImportedProducts() throws Exception {
        given(importExcelCatalog.execute(any())).willReturn(new ImportCatalogResult(3));

        mockMvc.perform(multipart(IMPORT_CATALOG_ENDPOINT).file(SPREADSHEET).with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.importedProducts").value(3));
    }

    @Test
    void returnsBadRequestWithErrorsWhenCatalogIsInvalid() throws Exception {
        given(importExcelCatalog.execute(any()))
                .willThrow(new InvalidCatalogException(List.of("row 2: sku is required", "row 3: price is required")));

        mockMvc.perform(multipart(IMPORT_CATALOG_ENDPOINT).file(SPREADSHEET).with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0]").value("row 2: sku is required"))
                .andExpect(jsonPath("$.errors[1]").value("row 3: price is required"));
    }

    @Test
    void returnsBadRequestWhenFileIsMissing() throws Exception {
        mockMvc.perform(multipart(IMPORT_CATALOG_ENDPOINT).with(admin()))
                .andExpect(status().isBadRequest());
    }

    private static JwtRequestPostProcessor admin() {
        return jwt().authorities(new SimpleGrantedAuthority("ROLE_admin"));
    }

}
