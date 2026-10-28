package br.com.puc.multiplataforma.bffgateway.infra.billing;

import br.com.puc.multiplataforma.bffgateway.MockGatewaysTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@MockGatewaysTest
class InvoiceRoutesMockModeTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void listsTheMockInvoicesMostRecentFirst() throws Exception {
        mockMvc.perform(get("/invoices").with(withRole("fiscal")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invoices.length()").value(6))
                .andExpect(jsonPath("$.invoices[0].externalOrderId").value("AMZ-1000001"))
                .andExpect(jsonPath("$.invoices[0].status").value("PAYMENT_FAILED"))
                .andExpect(jsonPath("$.limit").value(20));
    }

    @Test
    void filtersTheMockInvoicesByOrder() throws Exception {
        mockMvc.perform(get("/invoices").param("orderId", "6f1c2b8e-0000-4000-8000-000000000001").with(withRole("store")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invoices.length()").value(1))
                .andExpect(jsonPath("$.invoices[0].status").value("PAID"))
                .andExpect(jsonPath("$.invoices[0].commissionAmount").value(2035.00))
                .andExpect(jsonPath("$.invoices[0].netAmount").value(16465.00));
    }

    @Test
    void returnsAMockInvoiceAndNotFoundForAnUnknownOne() throws Exception {
        mockMvc.perform(get("/invoices/1d7e3a10-0000-4000-8000-000000000002").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAYMENT_FAILED"))
                .andExpect(jsonPath("$.failureReason").value("INSUFFICIENT_FUNDS"));
        mockMvc.perform(get("/invoices/1d7e3a10-0000-4000-8000-0000000000ff").with(withRole("admin")))
                .andExpect(status().isNotFound());
    }

    @Test
    void appliesTheAuthorizationRulesToTheMockRoutes() throws Exception {
        mockMvc.perform(get("/invoices")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/invoices").with(withRole("csm"))).andExpect(status().isForbidden());
        mockMvc.perform(get("/invoices").with(withRole("specialist"))).andExpect(status().isForbidden());
    }

}
