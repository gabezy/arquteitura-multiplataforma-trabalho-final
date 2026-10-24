package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.LocalDate;
import java.util.List;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.keycloakJwt;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({OrderController.class, SalesReportController.class})
@AutoConfigureTracing
@Import(SecurityConfig.class)
class SalesReportControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ListOrders listOrders;

    @MockitoBean
    private GetOrder getOrder;

    @MockitoBean
    private GetSalesByMarketplace getSalesByMarketplace;

    @BeforeEach
    void setUp() {
        given(getSalesByMarketplace.execute(any())).willReturn(
                new SalesByMarketplaceReport(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), List.of()));
    }

    @Test
    void returnsUnauthorizedWithoutToken() throws Exception {
        mockMvc.perform(report()).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "csm"})
    void returnsOkForTheRolesThatFollowTheReports(String role) throws Exception {
        mockMvc.perform(report().with(withRole(role))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"store", "specialist", "fiscal", "customer"})
    void returnsForbiddenForTheRolesThatDoNotFollowTheReports(String role) throws Exception {
        mockMvc.perform(report().with(withRole(role))).andExpect(status().isForbidden());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheCsmRole() throws Exception {
        given(jwtDecoder.decode("csm-token")).willReturn(keycloakJwt("csm-token", "csm"));

        mockMvc.perform(report().header("Authorization", "Bearer csm-token"))
                .andExpect(status().isOk());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheStoreRole() throws Exception {
        given(jwtDecoder.decode("store-token")).willReturn(keycloakJwt("store-token", "store"));

        mockMvc.perform(report().header("Authorization", "Bearer store-token"))
                .andExpect(status().isForbidden());
    }

    private static MockHttpServletRequestBuilder report() {
        return get("/reports/sales-by-marketplace").param("from", "2026-10-01").param("to", "2026-10-31");
    }

}
