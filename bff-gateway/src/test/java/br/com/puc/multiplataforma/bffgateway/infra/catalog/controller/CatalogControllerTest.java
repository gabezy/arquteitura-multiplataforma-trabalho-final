package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidProductException;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.changeprice.ChangeProductPrice;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportCatalogResult;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.importcatalog.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.math.BigDecimal;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;
import static org.mockito.BDDMockito.willThrow;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(CatalogController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class CatalogControllerTest {

    private static final String IMPORT_CATALOG_ENDPOINT = "/catalog/import/xlsx";
    private static final String CHANGE_PRICE_ENDPOINT = "/catalog/products/{sku}/price";
    private static final MockMultipartFile SPREADSHEET =
            new MockMultipartFile("file", "catalog.xlsx", null, new byte[]{1});

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ImportExcelCatalog importExcelCatalog;

    @MockitoBean
    private ChangeProductPrice changeProductPrice;

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

    @Test
    void changesThePriceOfTheSku() throws Exception {
        mockMvc.perform(changePriceRequest("{\"price\": 4999.90}").with(admin()))
                .andExpect(status().isNoContent());

        then(changeProductPrice).should().execute("NB-001", new BigDecimal("4999.90"));
    }

    @Test
    void returnsNotFoundWhenTheCatalogDoesNotKnowTheSku() throws Exception {
        willThrow(new ResourceNotFoundException("product", "NB-001")).given(changeProductPrice).execute(any(), any());

        mockMvc.perform(changePriceRequest("{\"price\": 10}").with(admin()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("product 'NB-001' not found"));
    }

    @Test
    void returnsBadRequestWhenThePriceIsInvalid() throws Exception {
        willThrow(new InvalidProductException("price must not be negative")).given(changeProductPrice).execute(any(), any());

        mockMvc.perform(changePriceRequest("{\"price\": -1}").with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("price must not be negative"));
    }

    @Test
    void returnsBadRequestWhenTheBodyIsMalformed() throws Exception {
        mockMvc.perform(changePriceRequest("{\"price\": ").with(admin()))
                .andExpect(status().isBadRequest());

        then(changeProductPrice).shouldHaveNoInteractions();
    }

    @Test
    void returnsServiceUnavailableWhenTheCatalogIsDown() throws Exception {
        willThrow(new DownstreamUnavailableException("catalog-service", new RuntimeException()))
                .given(changeProductPrice).execute(any(), any());

        mockMvc.perform(changePriceRequest("{\"price\": 10}").with(admin()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.service").value("catalog-service"));
    }

    private static MockHttpServletRequestBuilder changePriceRequest(String body) {
        return patch(CHANGE_PRICE_ENDPOINT, "NB-001").contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static JwtRequestPostProcessor admin() {
        return jwt().authorities(new SimpleGrantedAuthority("ROLE_admin"));
    }

}
