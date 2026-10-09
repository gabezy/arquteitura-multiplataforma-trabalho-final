package br.com.puc.multiplataforma.bffgateway.infra.security;

import br.com.puc.multiplataforma.bffgateway.infra.observability.AuthenticatedUserMdcFilter;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class AuthenticatedUserMdcFilterTest {

    private final AuthenticatedUserMdcFilter filter = new AuthenticatedUserMdcFilter();

    @AfterEach
    void clearContexts() {
        SecurityContextHolder.clearContext();
        MDC.clear();
    }

    @Test
    void putsTokenSubjectInMdcDuringRequest() throws Exception {
        authenticateAs("user-123");
        AtomicReference<String> userIdDuringChain = new AtomicReference<>();

        filter.doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), capturingUserId(userIdDuringChain));

        assertThat(userIdDuringChain.get()).isEqualTo("user-123");
    }

    @Test
    void removesUserIdFromMdcAfterRequest() throws Exception {
        authenticateAs("user-123");

        filter.doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), (request, response) -> { });

        assertThat(MDC.get(AuthenticatedUserMdcFilter.USER_ID_KEY)).isNull();
    }

    @Test
    void leavesMdcEmptyWhenRequestIsNotAuthenticatedWithJwt() throws Exception {
        AtomicReference<String> userIdDuringChain = new AtomicReference<>("not-called");

        filter.doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), capturingUserId(userIdDuringChain));

        assertThat(userIdDuringChain.get()).isNull();
    }

    private static FilterChain capturingUserId(AtomicReference<String> userId) {
        return (request, response) -> userId.set(MDC.get(AuthenticatedUserMdcFilter.USER_ID_KEY));
    }

    private static void authenticateAs(String subject) {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject(subject)
                .build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

}
