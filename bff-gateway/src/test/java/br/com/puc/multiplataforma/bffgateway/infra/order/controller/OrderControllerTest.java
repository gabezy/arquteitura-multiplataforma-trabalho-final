package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderFilter;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.OrderStatus;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.Test;
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
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({OrderController.class, SalesReportController.class})
@AutoConfigureTracing
@Import(SecurityConfig.class)
class OrderControllerTest {

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

    @Test
    void listsTheOrdersOfTheDefaultPage() throws Exception {
        given(listOrders.execute(new OrderFilter(null, null), new PageRequest(20, 0)))
                .willReturn(new Page<>(List.of(order()), 20, 0));

        mockMvc.perform(get("/orders").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders[0].id").value(ORDER_ID.toString()))
                .andExpect(jsonPath("$.orders[0].marketplace").value("MERCADO_LIVRE"))
                .andExpect(jsonPath("$.orders[0].externalOrderId").value("ML-2000001"))
                .andExpect(jsonPath("$.orders[0].status").value("PAID"))
                .andExpect(jsonPath("$.orders[0].total").value(18500.00))
                .andExpect(jsonPath("$.orders[0].items[0].sku").value("MON-002"))
                .andExpect(jsonPath("$.orders[0].items[0].quantity").value(1))
                .andExpect(jsonPath("$.orders[0].items[0].unitPrice").value(18500.00))
                .andExpect(jsonPath("$.orders[0].cancellationReason").value(nullValue()))
                .andExpect(jsonPath("$.orders[0].createdAt").value("2026-10-28T13:05:00Z"))
                .andExpect(jsonPath("$.orders[0].updatedAt").value("2026-10-28T13:05:06Z"))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void passesTheFiltersAndThePaginationToTheUseCase() throws Exception {
        given(listOrders.execute(any(), any())).willReturn(new Page<>(List.of(), 5, 10));

        mockMvc.perform(get("/orders")
                        .param("marketplace", "AMAZON")
                        .param("status", "PAID")
                        .param("limit", "5")
                        .param("offset", "10")
                        .with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders").isEmpty())
                .andExpect(jsonPath("$.limit").value(5))
                .andExpect(jsonPath("$.offset").value(10));

        verify(listOrders).execute(new OrderFilter(Marketplace.AMAZON, OrderStatus.PAID), new PageRequest(5, 10));
    }

    @Test
    void returnsBadRequestForAnUnknownStatus() throws Exception {
        mockMvc.perform(get("/orders").param("status", "SHIPPED").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void returnsBadRequestForAnUnknownMarketplace() throws Exception {
        mockMvc.perform(get("/orders").param("marketplace", "ALIEXPRESS").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBadRequestWhenTheLimitIsAboveTheMaximum() throws Exception {
        mockMvc.perform(get("/orders").param("limit", "101").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("limit must be between 1 and 100"));
    }

    @Test
    void returnsBadRequestWhenTheOffsetIsNegative() throws Exception {
        mockMvc.perform(get("/orders").param("offset", "-1").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("offset must not be negative"));
    }

    @Test
    void returnsBadRequestWhenTheOrderServiceRejectsTheRequest() throws Exception {
        given(listOrders.execute(any(), any())).willThrow(new InvalidRequestException("status is not supported"));

        mockMvc.perform(get("/orders").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("status is not supported"));
    }

    @Test
    void returnsTheOrderById() throws Exception {
        given(getOrder.execute(ORDER_ID)).willReturn(order());

        mockMvc.perform(get("/orders/{id}", ORDER_ID).with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ORDER_ID.toString()))
                .andExpect(jsonPath("$.externalOrderId").value("ML-2000001"))
                .andExpect(jsonPath("$.items[0].sku").value("MON-002"));
    }

    @Test
    void returnsNotFoundWhenTheOrderDoesNotExist() throws Exception {
        given(getOrder.execute(ORDER_ID)).willThrow(new ResourceNotFoundException("order", ORDER_ID));

        mockMvc.perform(get("/orders/{id}", ORDER_ID).with(withRole("admin")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").value("order '%s' not found".formatted(ORDER_ID)));
    }

    @Test
    void returnsBadRequestForAMalformedOrderId() throws Exception {
        mockMvc.perform(get("/orders/not-a-uuid").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsServiceUnavailableWhenTheOrderServiceIsDownOnTheList() throws Exception {
        given(listOrders.execute(any(), any())).willThrow(new DownstreamUnavailableException("order-service", null));

        mockMvc.perform(get("/orders").with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status").value(503))
                .andExpect(jsonPath("$.detail").value("order-service is unavailable"))
                .andExpect(jsonPath("$.service").value("order-service"));
    }

    @Test
    void returnsServiceUnavailableWhenTheOrderServiceIsDownOnTheDetail() throws Exception {
        given(getOrder.execute(ORDER_ID)).willThrow(new DownstreamUnavailableException("order-service", null));

        mockMvc.perform(get("/orders/{id}", ORDER_ID).with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("order-service is unavailable"));
    }

    @Test
    void returnsBadGatewayWhenTheOrderServiceAnswersWithAnError() throws Exception {
        given(listOrders.execute(any(), any())).willThrow(new DownstreamFailureException("order-service", "HTTP 500", null));

        mockMvc.perform(get("/orders").with(withRole("admin")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.status").value(502))
                .andExpect(jsonPath("$.detail").value("order-service returned an unexpected response: HTTP 500"))
                .andExpect(jsonPath("$.service").value("order-service"));
    }

}
