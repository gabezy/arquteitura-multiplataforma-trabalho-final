package br.com.puc.multiplataforma.bffgateway.infra.catalog.controller;

import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportCatalogResult;
import br.com.puc.multiplataforma.bffgateway.core.catalog.usecase.ImportExcelCatalog;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(CatalogController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class CatalogControllerSecurityTest {

    private static final String IMPORT_CATALOG_ENDPOINT = "/catalog/import/xlsx";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ImportExcelCatalog importExcelCatalog;

    @BeforeEach
    void setUp() {
        given(importExcelCatalog.execute(any())).willReturn(new ImportCatalogResult(1));
    }

    @Test
    void returnsUnauthorizedWithoutToken() throws Exception {
        mockMvc.perform(importRequest())
                .andExpect(status().isUnauthorized());
    }

    @Test
    void returnsForbiddenForCustomer() throws Exception {
        mockMvc.perform(importRequest()
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_customer"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void returnsOkForAdmin() throws Exception {
        mockMvc.perform(importRequest()
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_admin"))))
                .andExpect(status().isOk());
    }

    @Test
    void appliesKeycloakConverterToBearerTokenWithAdminRole() throws Exception {
        given(jwtDecoder.decode("admin-token")).willReturn(keycloakJwt("admin-token", List.of("customer", "admin")));

        mockMvc.perform(importRequest().header("Authorization", "Bearer admin-token"))
                .andExpect(status().isOk());
    }

    @Test
    void appliesKeycloakConverterToBearerTokenWithCustomerRole() throws Exception {
        given(jwtDecoder.decode("customer-token")).willReturn(keycloakJwt("customer-token", List.of("customer")));

        mockMvc.perform(importRequest().header("Authorization", "Bearer customer-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    void appliesKeycloakConverterToBearerTokenWithCustomerRoleAndCatalogWriteScope() throws Exception {
        given(jwtDecoder.decode("customer-token"))
                .willReturn(keycloakJwt("customer-token", List.of("customer"), "catalog:write"));

        mockMvc.perform(importRequest().header("Authorization", "Bearer customer-token"))
                .andExpect(status().isOk());
    }

    private static MockMultipartHttpServletRequestBuilder importRequest() {
        return multipart(IMPORT_CATALOG_ENDPOINT)
                .file(new MockMultipartFile("file", "catalog.xlsx", null, new byte[]{1}));
    }

    private static Jwt keycloakJwt(String tokenValue, List<String> roles) {
        return Jwt.withTokenValue(tokenValue)
                .header("alg", "none")
                .subject("user-id")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("scope", "openid profile email")
                .claim("realm_access", Map.of("roles", roles))
                .claim("preferred_username", "testuser")
                .build();
    }

    private static Jwt keycloakJwt(String tokenValue, List<String> roles, String... scopes) {
        return Jwt.withTokenValue(tokenValue)
                .header("alg", "none")
                .subject("user-id")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("scope", "openid profile email ".concat(String.join(" ", scopes)))
                .claim("realm_access", Map.of("roles", roles))
                .claim("preferred_username", "testuser")
                .build();
    }

}
