package br.com.puc.multiplataforma.bffgateway.infra.billing.controller;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceFilter;
import br.com.puc.multiplataforma.bffgateway.core.billing.domain.InvoiceStatus;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
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

import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.INVOICE_ID;
import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.ORDER_ID;
import static br.com.puc.multiplataforma.bffgateway.core.billing.InvoiceFixtures.invoice;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(InvoiceController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class InvoiceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ListInvoices listInvoices;

    @MockitoBean
    private GetInvoice getInvoice;

    @Test
    void listsTheInvoicesOfTheDefaultPage() throws Exception {
        given(listInvoices.execute(new InvoiceFilter(null, null, null), new PageRequest(20, 0)))
                .willReturn(new Page<>(List.of(invoice()), 20, 0));

        mockMvc.perform(get("/invoices").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invoices[0].id").value(INVOICE_ID.toString()))
                .andExpect(jsonPath("$.invoices[0].orderId").value(ORDER_ID.toString()))
                .andExpect(jsonPath("$.invoices[0].externalOrderId").value("ML-2000001"))
                .andExpect(jsonPath("$.invoices[0].marketplace").value("MERCADO_LIVRE"))
                .andExpect(jsonPath("$.invoices[0].status").value("PAID"))
                .andExpect(jsonPath("$.invoices[0].amount").value(18500.00))
                .andExpect(jsonPath("$.invoices[0].commissionPercent").value(11.00))
                .andExpect(jsonPath("$.invoices[0].commissionAmount").value(2035.00))
                .andExpect(jsonPath("$.invoices[0].netAmount").value(16465.00))
                .andExpect(jsonPath("$.invoices[0].items[0].sku").value("MON-002"))
                .andExpect(jsonPath("$.invoices[0].items[0].quantity").value(1))
                .andExpect(jsonPath("$.invoices[0].items[0].unitPrice").value(18500.00))
                .andExpect(jsonPath("$.invoices[0].items[0].amount").value(18500.00))
                .andExpect(jsonPath("$.invoices[0].issuedAt").value("2026-10-28T13:05:03Z"))
                .andExpect(jsonPath("$.invoices[0].cancelledAt").value(nullValue()))
                .andExpect(jsonPath("$.invoices[0].cancellationReason").value(nullValue()))
                .andExpect(jsonPath("$.invoices[0].pspTransactionId").value("ch_paid_" + INVOICE_ID))
                .andExpect(jsonPath("$.invoices[0].failureReason").value(nullValue()))
                .andExpect(jsonPath("$.invoices[0].paidAt").value("2026-10-28T13:05:06Z"))
                .andExpect(jsonPath("$.invoices[0].failedAt").value(nullValue()))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void passesTheFiltersAndThePaginationToTheUseCase() throws Exception {
        given(listInvoices.execute(any(), any())).willReturn(new Page<>(List.of(), 5, 10));

        mockMvc.perform(get("/invoices")
                        .param("orderId", ORDER_ID.toString())
                        .param("status", "PAYMENT_PENDING")
                        .param("marketplace", "SHOPEE")
                        .param("limit", "5")
                        .param("offset", "10")
                        .with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invoices").isEmpty())
                .andExpect(jsonPath("$.limit").value(5))
                .andExpect(jsonPath("$.offset").value(10));

        verify(listInvoices).execute(new InvoiceFilter(ORDER_ID, InvoiceStatus.PAYMENT_PENDING, Marketplace.SHOPEE),
                new PageRequest(5, 10));
    }

    @Test
    void returnsBadRequestForAnUnknownStatus() throws Exception {
        mockMvc.perform(get("/invoices").param("status", "REFUNDED").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void returnsBadRequestForAnUnknownMarketplace() throws Exception {
        mockMvc.perform(get("/invoices").param("marketplace", "ALIEXPRESS").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBadRequestForAMalformedOrderId() throws Exception {
        mockMvc.perform(get("/invoices").param("orderId", "not-a-uuid").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBadRequestWhenTheLimitIsOutOfRange() throws Exception {
        mockMvc.perform(get("/invoices").param("limit", "0").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("limit must be between 1 and 100"));
    }

    @Test
    void returnsBadRequestWhenTheBillingServiceRejectsTheRequest() throws Exception {
        given(listInvoices.execute(any(), any())).willThrow(new InvalidRequestException("orderId is not supported"));

        mockMvc.perform(get("/invoices").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("orderId is not supported"));
    }

    @Test
    void returnsTheInvoiceById() throws Exception {
        given(getInvoice.execute(INVOICE_ID)).willReturn(invoice());

        mockMvc.perform(get("/invoices/{id}", INVOICE_ID).with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(INVOICE_ID.toString()))
                .andExpect(jsonPath("$.status").value("PAID"))
                .andExpect(jsonPath("$.items[0].sku").value("MON-002"));
    }

    @Test
    void returnsNotFoundWhenTheInvoiceDoesNotExist() throws Exception {
        given(getInvoice.execute(INVOICE_ID)).willThrow(new ResourceNotFoundException("invoice", INVOICE_ID));

        mockMvc.perform(get("/invoices/{id}", INVOICE_ID).with(withRole("admin")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").value("invoice '%s' not found".formatted(INVOICE_ID)));
    }

    @Test
    void returnsBadRequestForAMalformedInvoiceId() throws Exception {
        mockMvc.perform(get("/invoices/not-a-uuid").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsServiceUnavailableWhenTheBillingServiceIsDownOnTheList() throws Exception {
        given(listInvoices.execute(any(), any())).willThrow(new DownstreamUnavailableException("billing-service", null));

        mockMvc.perform(get("/invoices").with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status").value(503))
                .andExpect(jsonPath("$.detail").value("billing-service is unavailable"))
                .andExpect(jsonPath("$.service").value("billing-service"));
    }

    @Test
    void returnsServiceUnavailableWhenTheBillingServiceIsDownOnTheDetail() throws Exception {
        given(getInvoice.execute(INVOICE_ID)).willThrow(new DownstreamUnavailableException("billing-service", null));

        mockMvc.perform(get("/invoices/{id}", INVOICE_ID).with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("billing-service is unavailable"));
    }

    @Test
    void returnsBadGatewayWhenTheBillingServiceAnswersWithAnError() throws Exception {
        given(listInvoices.execute(any(), any())).willThrow(new DownstreamFailureException("billing-service", "HTTP 500", null));

        mockMvc.perform(get("/invoices").with(withRole("admin")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.status").value(502))
                .andExpect(jsonPath("$.service").value("billing-service"));
    }

}
