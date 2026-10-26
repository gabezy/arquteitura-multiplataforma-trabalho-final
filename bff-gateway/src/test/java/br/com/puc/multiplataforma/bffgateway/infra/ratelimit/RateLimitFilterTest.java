package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller.ListingController;
import br.com.puc.multiplataforma.bffgateway.infra.security.SecurityConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;

import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.listing;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.core.authority.AuthorityUtils.createAuthorityList;

@WebMvcTest(ListingController.class)
@AutoConfigureTracing
@Import(SecurityConfig.class)
class RateLimitFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @MockitoBean
    private RateLimiter rateLimiter;

    @MockitoBean
    private ListListings listListings;

    @MockitoBean
    private GetListing getListing;

    @BeforeEach
    void setUp() {
        given(listListings.execute(any(), any())).willReturn(new Page<>(List.of(listing()), 20, 0));
    }

    @Test
    void returns429WithRetryAfterWhenDenied() throws Exception {
        given(rateLimiter.tryAcquire("user-123")).willReturn(new RateLimitDecision(false, 45));

        mockMvc.perform(get("/listings").with(userWithRoleStore()))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "45"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Too Many Requests"))
                .andExpect(jsonPath("$.detail").value("Rate limit exceeded"));
    }

    @Test
    void passesWhenAllowed() throws Exception {
        given(rateLimiter.tryAcquire("user-123")).willReturn(new RateLimitDecision(true, 0));

        mockMvc.perform(get("/listings").with(userWithRoleStore())).andExpect(status().isOk());
    }

    @Test
    void skipsRequestsWithoutAToken() throws Exception {
        mockMvc.perform(get("/listings")).andExpect(status().isUnauthorized());

        verifyNoInteractions(rateLimiter);
    }

    private static RequestPostProcessor userWithRoleStore() {
        return jwt().jwt(token -> token.subject("user-123")).authorities(createAuthorityList("ROLE_store"));
    }

}
