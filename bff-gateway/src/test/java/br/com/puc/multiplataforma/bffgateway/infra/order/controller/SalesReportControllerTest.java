package br.com.puc.multiplataforma.bffgateway.infra.order.controller;

import br.com.puc.multiplataforma.bffgateway.core.order.domain.MarketplaceSales;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.ReportPeriod;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({OrderController.class, SalesReportController.class})
@AutoConfigureTracing
@Import(SecurityConfig.class)
class SalesReportControllerTest {

    private static final String ENDPOINT = "/reports/sales-by-marketplace";
    private static final ReportPeriod OCTOBER = new ReportPeriod(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"));

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
    void returnsTheSalesByMarketplaceOfThePeriod() throws Exception {
        given(getSalesByMarketplace.execute(OCTOBER)).willReturn(new SalesByMarketplaceReport(
                OCTOBER.from(), OCTOBER.to(),
                List.of(new MarketplaceSales(Marketplace.AMAZON, 3, 5, new BigDecimal("75000.00")))));

        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-01").param("to", "2026-10-31").with(withRole("csm")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-10-01"))
                .andExpect(jsonPath("$.to").value("2026-10-31"))
                .andExpect(jsonPath("$.marketplaces[0].marketplace").value("AMAZON"))
                .andExpect(jsonPath("$.marketplaces[0].orders").value(3))
                .andExpect(jsonPath("$.marketplaces[0].units").value(5))
                .andExpect(jsonPath("$.marketplaces[0].totalAmount").value(75000.00));
        verify(getSalesByMarketplace).execute(OCTOBER);
    }

    @Test
    void returnsAnEmptyListWhenThereAreNoSales() throws Exception {
        given(getSalesByMarketplace.execute(OCTOBER))
                .willReturn(new SalesByMarketplaceReport(OCTOBER.from(), OCTOBER.to(), List.of()));

        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-01").param("to", "2026-10-31").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.marketplaces").isEmpty());
    }

    @Test
    void returnsBadRequestWhenThePeriodEndsBeforeItStarts() throws Exception {
        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-31").param("to", "2026-10-01").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("from must not be after to"));
    }

    @Test
    void returnsBadRequestWhenThePeriodIsMissing() throws Exception {
        mockMvc.perform(get(ENDPOINT).with(withRole("admin")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-01").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBadRequestForAMalformedDate() throws Exception {
        mockMvc.perform(get(ENDPOINT).param("from", "01/10/2026").param("to", "2026-10-31").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsServiceUnavailableWhenTheOrderServiceIsDown() throws Exception {
        given(getSalesByMarketplace.execute(any())).willThrow(new DownstreamUnavailableException("order-service", null));

        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-01").param("to", "2026-10-31").with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("order-service is unavailable"));
    }

    @Test
    void returnsBadGatewayWhenTheOrderServiceAnswersWithAnError() throws Exception {
        given(getSalesByMarketplace.execute(any())).willThrow(new DownstreamFailureException("order-service", "HTTP 500", null));

        mockMvc.perform(get(ENDPOINT).param("from", "2026-10-01").param("to", "2026-10-31").with(withRole("admin")))
                .andExpect(status().isBadGateway());
    }

}
