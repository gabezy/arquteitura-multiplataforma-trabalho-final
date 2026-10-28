package br.com.puc.multiplataforma.bffgateway.infra.order;

import br.com.puc.multiplataforma.bffgateway.MockGatewaysTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@MockGatewaysTest
class OrderRoutesMockModeTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void listsTheMockOrdersMostRecentFirst() throws Exception {
        mockMvc.perform(get("/orders").with(withRole("csm")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders.length()").value(8))
                .andExpect(jsonPath("$.orders[0].externalOrderId").value("AMZ-1000001"))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void filtersAndPaginatesTheMockOrders() throws Exception {
        mockMvc.perform(get("/orders").param("marketplace", "SHOPEE").param("status", "CONFIRMED").param("limit", "1")
                        .with(withRole("store")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders.length()").value(1))
                .andExpect(jsonPath("$.orders[0].externalOrderId").value("SP-3000003"))
                .andExpect(jsonPath("$.limit").value(1));
    }

    @Test
    void returnsAMockOrderAndNotFoundForAnUnknownOne() throws Exception {
        mockMvc.perform(get("/orders/6f1c2b8e-0000-4000-8000-000000000001").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.externalOrderId").value("ML-2000001"))
                .andExpect(jsonPath("$.items[0].sku").value("MON-002"));
        mockMvc.perform(get("/orders/6f1c2b8e-0000-4000-8000-0000000000ff").with(withRole("admin")))
                .andExpect(status().isNotFound());
    }

    @Test
    void returnsTheMockSalesReport() throws Exception {
        mockMvc.perform(get("/reports/sales-by-marketplace").param("from", "2026-10-01").param("to", "2026-10-31")
                        .with(withRole("csm")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.marketplaces.length()").value(3))
                .andExpect(jsonPath("$.marketplaces[2].marketplace").value("SHOPEE"))
                .andExpect(jsonPath("$.marketplaces[2].orders").value(2))
                .andExpect(jsonPath("$.marketplaces[2].units").value(3))
                .andExpect(jsonPath("$.marketplaces[2].totalAmount").value(18879.80));
    }

    @Test
    void appliesTheAuthorizationRulesToTheMockRoutes() throws Exception {
        mockMvc.perform(get("/orders")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/orders").with(withRole("fiscal"))).andExpect(status().isForbidden());
        mockMvc.perform(get("/reports/sales-by-marketplace").param("from", "2026-10-01").param("to", "2026-10-31")
                        .with(withRole("store")))
                .andExpect(status().isForbidden());
    }

}
