package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
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

import static br.com.puc.multiplataforma.bffgateway.core.order.OrderFixtures.ORDER_ID;
import static br.com.puc.multiplataforma.bffgateway.core.order.OrderFixtures.order;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.keycloakJwt;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({OrderController.class, SalesReportController.class})
@AutoConfigureTracing
@Import(SecurityConfig.class)
class OrderControllerSecurityTest {

    private static final String ORDERS = "/orders";
    private static final String ORDER = "/orders/" + ORDER_ID;

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
        given(listOrders.execute(any(), any())).willReturn(new Page<>(List.of(order()), 20, 0));
        given(getOrder.execute(ORDER_ID)).willReturn(order());
    }

    @Test
    void returnsUnauthorizedWithoutToken() throws Exception {
        mockMvc.perform(get(ORDERS)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(ORDER)).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "store", "csm"})
    void returnsOkForTheRolesThatFollowOrders(String role) throws Exception {
        mockMvc.perform(get(ORDERS).with(withRole(role))).andExpect(status().isOk());
        mockMvc.perform(get(ORDER).with(withRole(role))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"specialist", "fiscal", "customer"})
    void returnsForbiddenForTheRolesThatDoNotFollowOrders(String role) throws Exception {
        mockMvc.perform(get(ORDERS).with(withRole(role))).andExpect(status().isForbidden());
        mockMvc.perform(get(ORDER).with(withRole(role))).andExpect(status().isForbidden());
    }

    @Test
    void returnsForbiddenForATokenWithoutRoles() throws Exception {
        mockMvc.perform(get(ORDERS).with(jwt()))
                .andExpect(status().isForbidden());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheCsmRole() throws Exception {
        given(jwtDecoder.decode("csm-token")).willReturn(keycloakJwt("csm-token", "csm"));

        mockMvc.perform(get(ORDERS).header("Authorization", "Bearer csm-token"))
                .andExpect(status().isOk());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheFiscalRole() throws Exception {
        given(jwtDecoder.decode("fiscal-token")).willReturn(keycloakJwt("fiscal-token", "fiscal"));

        mockMvc.perform(get(ORDERS).header("Authorization", "Bearer fiscal-token"))
                .andExpect(status().isForbidden());
    }

}
