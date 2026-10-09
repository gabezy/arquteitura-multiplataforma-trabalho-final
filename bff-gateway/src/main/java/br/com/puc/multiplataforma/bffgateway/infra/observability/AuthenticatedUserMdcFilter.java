package br.com.puc.multiplataforma.bffgateway.infra.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class AuthenticatedUserMdcFilter extends OncePerRequestFilter {

    public static final String USER_ID_KEY = "user.id";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (!(SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token)) {
            filterChain.doFilter(request, response);
            return;
        }
        try (var _ = MDC.putCloseable(USER_ID_KEY, token.getToken().getSubject())) {
            filterChain.doFilter(request, response);
        }
    }

}
