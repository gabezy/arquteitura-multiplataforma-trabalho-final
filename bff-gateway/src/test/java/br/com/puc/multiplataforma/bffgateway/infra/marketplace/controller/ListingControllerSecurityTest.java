package br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
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

import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.LISTING_ID;
import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.listing;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.keycloakJwt;
import static br.com.puc.multiplataforma.bffgateway.infra.security.TestTokens.withRole;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ListingController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class ListingControllerSecurityTest {

    private static final String LISTINGS = "/listings";
    private static final String LISTING = "/listings/" + LISTING_ID;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private ListListings listListings;

    @MockitoBean
    private GetListing getListing;

    @BeforeEach
    void setUp() {
        given(listListings.execute(any(), any())).willReturn(new Page<>(List.of(listing()), 20, 0));
        given(getListing.execute(LISTING_ID)).willReturn(listing());
    }

    @Test
    void returnsUnauthorizedWithoutToken() throws Exception {
        mockMvc.perform(get(LISTINGS)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(LISTING)).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "store"})
    void returnsOkForTheRolesThatFollowListings(String role) throws Exception {
        mockMvc.perform(get(LISTINGS).with(withRole(role))).andExpect(status().isOk());
        mockMvc.perform(get(LISTING).with(withRole(role))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"specialist", "fiscal", "csm", "customer"})
    void returnsForbiddenForTheRolesThatDoNotFollowListings(String role) throws Exception {
        mockMvc.perform(get(LISTINGS).with(withRole(role))).andExpect(status().isForbidden());
        mockMvc.perform(get(LISTING).with(withRole(role))).andExpect(status().isForbidden());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheStoreRole() throws Exception {
        given(jwtDecoder.decode("store-token")).willReturn(keycloakJwt("store-token", "store"));

        mockMvc.perform(get(LISTINGS).header("Authorization", "Bearer store-token"))
                .andExpect(status().isOk());
    }

    @Test
    void appliesTheKeycloakConverterToABearerTokenWithTheFiscalRole() throws Exception {
        given(jwtDecoder.decode("fiscal-token")).willReturn(keycloakJwt("fiscal-token", "fiscal"));

        mockMvc.perform(get(LISTINGS).header("Authorization", "Bearer fiscal-token"))
                .andExpect(status().isForbidden());
    }

}
