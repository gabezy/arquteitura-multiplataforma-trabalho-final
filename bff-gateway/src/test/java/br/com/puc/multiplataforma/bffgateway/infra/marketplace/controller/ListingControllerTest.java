package br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
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

import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.LISTING_ID;
import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.listing;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ListingController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class ListingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ListListings listListings;

    @MockitoBean
    private GetListing getListing;

    @Test
    void listsTheListingsOfTheDefaultPage() throws Exception {
        given(listListings.execute(new ListingFilter(null, null, null), new PageRequest(20, 0)))
                .willReturn(new Page<>(List.of(listing()), 20, 0));

        mockMvc.perform(get("/listings").with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings[0].id").value(LISTING_ID.toString()))
                .andExpect(jsonPath("$.listings[0].sku").value("OXI-001"))
                .andExpect(jsonPath("$.listings[0].marketplace").value("AMAZON"))
                .andExpect(jsonPath("$.listings[0].externalListingId").value("AMZ-LST-OXI-001"))
                .andExpect(jsonPath("$.listings[0].status").value("PUBLISHED"))
                .andExpect(jsonPath("$.listings[0].price").value(189.90))
                .andExpect(jsonPath("$.listings[0].stock").value(2))
                .andExpect(jsonPath("$.listings[0].failureReason").value(nullValue()))
                .andExpect(jsonPath("$.listings[0].updatedAt").value("2026-10-27T10:00:05Z"))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void passesTheFiltersAndThePaginationToTheUseCase() throws Exception {
        given(listListings.execute(any(), any())).willReturn(new Page<>(List.of(), 5, 10));

        mockMvc.perform(get("/listings")
                        .param("sku", "OXI-001")
                        .param("marketplace", "SHOPEE")
                        .param("status", "FAILED")
                        .param("limit", "5")
                        .param("offset", "10")
                        .with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings").isEmpty())
                .andExpect(jsonPath("$.limit").value(5))
                .andExpect(jsonPath("$.offset").value(10));

        verify(listListings).execute(new ListingFilter("OXI-001", Marketplace.SHOPEE, ListingStatus.FAILED), new PageRequest(5, 10));
    }

    @Test
    void treatsABlankSkuAsNoFilter() throws Exception {
        given(listListings.execute(any(), any())).willReturn(new Page<>(List.of(), 20, 0));

        mockMvc.perform(get("/listings").param("sku", " ").with(withRole("admin")))
                .andExpect(status().isOk());

        verify(listListings).execute(new ListingFilter(null, null, null), new PageRequest(20, 0));
    }

    @Test
    void returnsBadRequestForAnUnknownStatus() throws Exception {
        mockMvc.perform(get("/listings").param("status", "SUSPENDED").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void returnsBadRequestForAnUnknownMarketplace() throws Exception {
        mockMvc.perform(get("/listings").param("marketplace", "ALIEXPRESS").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBadRequestWhenTheOffsetIsNegative() throws Exception {
        mockMvc.perform(get("/listings").param("offset", "-5").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("offset must not be negative"));
    }

    @Test
    void returnsBadRequestWhenTheMarketplaceGatewayRejectsTheRequest() throws Exception {
        given(listListings.execute(any(), any())).willThrow(new InvalidRequestException("sku is not valid"));

        mockMvc.perform(get("/listings").with(withRole("admin")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("sku is not valid"));
    }

    @Test
    void returnsTheListingById() throws Exception {
        given(getListing.execute(LISTING_ID)).willReturn(listing());

        mockMvc.perform(get("/listings/{id}", LISTING_ID).with(withRole("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(LISTING_ID.toString()))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.sku").value("OXI-001"));
    }

    @Test
    void returnsNotFoundWhenTheListingDoesNotExist() throws Exception {
        given(getListing.execute(LISTING_ID)).willThrow(new ResourceNotFoundException("listing", LISTING_ID));

        mockMvc.perform(get("/listings/{id}", LISTING_ID).with(withRole("admin")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").value("listing '%s' not found".formatted(LISTING_ID)));
    }

    @Test
    void returnsBadRequestForAMalformedListingId() throws Exception {
        mockMvc.perform(get("/listings/not-a-uuid").with(withRole("admin")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void returnsServiceUnavailableWhenTheMarketplaceGatewayIsDownOnTheList() throws Exception {
        given(listListings.execute(any(), any())).willThrow(new DownstreamUnavailableException("marketplace-gateway", null));

        mockMvc.perform(get("/listings").with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status").value(503))
                .andExpect(jsonPath("$.detail").value("marketplace-gateway is unavailable"))
                .andExpect(jsonPath("$.service").value("marketplace-gateway"));
    }

    @Test
    void returnsServiceUnavailableWhenTheMarketplaceGatewayIsDownOnTheDetail() throws Exception {
        given(getListing.execute(LISTING_ID)).willThrow(new DownstreamUnavailableException("marketplace-gateway", null));

        mockMvc.perform(get("/listings/{id}", LISTING_ID).with(withRole("admin")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("marketplace-gateway is unavailable"));
    }

    @Test
    void returnsBadGatewayWhenTheMarketplaceGatewayAnswersWithAnError() throws Exception {
        given(listListings.execute(any(), any())).willThrow(new DownstreamFailureException("marketplace-gateway", "HTTP 500", null));

        mockMvc.perform(get("/listings").with(withRole("admin")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.status").value(502))
                .andExpect(jsonPath("$.service").value("marketplace-gateway"));
    }

}
