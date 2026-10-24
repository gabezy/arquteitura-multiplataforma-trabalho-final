package br.com.puc.multiplataforma.bffgateway.infra.openapi;

import br.com.puc.multiplataforma.bffgateway.MockGatewaysTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@MockGatewaysTest
class OpenApiDocsTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void publishesTheApiDocsWithoutToken() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("omni-market bff-gateway"))
                .andExpect(jsonPath("$.paths['/catalog/products/{sku}/price'].patch.summary")
                        .value("Altera o preço de um produto"))
                .andExpect(jsonPath("$.paths['/catalog/import/xlsx'].post").exists())
                .andExpect(jsonPath("$.paths['/orders'].get").exists())
                .andExpect(jsonPath("$.paths['/reports/sales-by-marketplace'].get").exists())
                .andExpect(jsonPath("$.paths['/invoices'].get").exists())
                .andExpect(jsonPath("$.paths['/listings'].get").exists());
    }

    @Test
    void asksForTheKeycloakBearerToken() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(jsonPath("$.components.securitySchemes.bearer-jwt.scheme").value("bearer"))
                .andExpect(jsonPath("$.components.securitySchemes.bearer-jwt.bearerFormat").value("JWT"))
                .andExpect(jsonPath("$.security[*].bearer-jwt").exists());
    }

    @Test
    void servesTheSwaggerUiWithoutToken() throws Exception {
        mockMvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk());
    }

}
