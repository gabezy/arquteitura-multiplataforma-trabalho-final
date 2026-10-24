package br.com.puc.multiplataforma.bffgateway.infra.billing.controller;

import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
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

import java.util.List;

import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.INVOICE_ID;
import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.invoice;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.keycloakJwt;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(InvoiceController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class InvoiceControllerSecurityTest {

    private static final String INVOICES = "/invoices";
    private static final String INVOICE = "/invoices/" + INVOICE_ID;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ListInvoices listInvoices;

    @MockitoBean
    private GetInvoice getInvoice;

    @BeforeEach
    void setUp() {
        given(listInvoices.execute(any(), any())).willReturn(new Page<>(List.of(invoice()), 20, 0));
        given(getInvoice.execute(INVOICE_ID)).willReturn(invoice());
    }

    @Test
    void returnsUnauthorizedWithoutToken() throws Exception {
        mockMvc.perform(get(INVOICES)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(INVOICE)).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "store", "fiscal"})
    void returnsOkForTheRolesThatFollowInvoices(String role) throws Exception {
        mockMvc.perform(get(INVOICES).with(withRole(role))).andExpect(status().isOk());
        mockMvc.perform(get(INVOICE).with(withRole(role))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"specialist", "csm", "customer"})
    void returnsForbiddenForTheRolesThatDoNotFollowInvoices(String role) throws Exception {
        mockMvc.perform(get(INVOICES).with(withRole(role))).andExpect(status().isForbidden());
        mockMvc.perform(get(INVOICE).with(withRole(role))).andExpect(status().isForbidden());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheFiscalRole() throws Exception {
        given(jwtDecoder.decode("fiscal-token")).willReturn(keycloakJwt("fiscal-token", "fiscal"));

        mockMvc.perform(get(INVOICES).header("Authorization", "Bearer fiscal-token"))
                .andExpect(status().isOk());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheCsmRole() throws Exception {
        given(jwtDecoder.decode("csm-token")).willReturn(keycloakJwt("csm-token", "csm"));

        mockMvc.perform(get(INVOICES).header("Authorization", "Bearer csm-token"))
                .andExpect(status().isForbidden());
    }

}
