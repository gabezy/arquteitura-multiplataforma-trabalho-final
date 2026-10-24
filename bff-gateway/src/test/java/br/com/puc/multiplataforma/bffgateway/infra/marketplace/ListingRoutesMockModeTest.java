package br.com.puc.multiplataforma.bffgateway.infra.marketplace;

import br.com.puc.multiplataforma.bffgateway.MockGatewaysTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@MockGatewaysTest
class ListingRoutesMockModeTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void listsTheMockListingsOfEachProductInEveryMarketplace() throws Exception {
        mockMvc.perform(get("/listings").with(withRole("store")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings.length()").value(6))
                .andExpect(jsonPath("$.listings[0].sku").value("MON-002"))
                .andExpect(jsonPath("$.listings[0].marketplace").value("AMAZON"))
                .andExpect(jsonPath("$.limit").value(20));
    }

    @Test
    void showsTheStatusOfAProductInEachMarketplace() throws Exception {
        mockMvc.perform(get("/listings").param("sku", "OXI-001").with(withRole("store")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings.length()").value(3))
                .andExpect(jsonPath("$.listings[0].status").value("PUBLISHED"))
                .andExpect(jsonPath("$.listings[2].marketplace").value("SHOPEE"))
                .andExpect(jsonPath("$.listings[2].status").value("FAILED"))
                .andExpect(jsonPath("$.listings[2].failureReason").value("HTTP 503 after retries"));
    }

    @Test
    void returnsAMockListingAndNotFoundForAnUnknownOne() throws Exception {
        mockMvc.perform(get("/listings/7a2b9c10-0000-4000-8000-000000000005").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sku").value("MON-002"))
                .andExpect(jsonPath("$.status").value("PENDING"));
        mockMvc.perform(get("/listings/7a2b9c10-0000-4000-8000-0000000000ff").with(withRole("admin")))
                .andExpect(status().isNotFound());
    }

    @Test
    void appliesTheAuthorizationRulesToTheMockRoutes() throws Exception {
        mockMvc.perform(get("/listings")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/listings").with(withRole("csm"))).andExpect(status().isForbidden());
        mockMvc.perform(get("/listings").with(withRole("fiscal"))).andExpect(status().isForbidden());
    }

}
