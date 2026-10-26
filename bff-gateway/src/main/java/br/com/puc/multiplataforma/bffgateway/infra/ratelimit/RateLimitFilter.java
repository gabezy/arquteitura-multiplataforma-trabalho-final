package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;

public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimiter rateLimiter;
    private final JsonMapper jsonMapper;

    public RateLimitFilter(RateLimiter rateLimiter, JsonMapper jsonMapper) {
        this.rateLimiter = rateLimiter;
        this.jsonMapper = jsonMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (!(SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token)) {
            filterChain.doFilter(request, response);
            return;
        }
        RateLimitDecision decision = rateLimiter.tryAcquire(token.getToken().getSubject());
        if (decision.allowed()) {
            filterChain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(decision.retryAfterSeconds()));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, "Rate limit exceeded");
        problem.setInstance(URI.create(request.getRequestURI()));
        jsonMapper.writeValue(response.getOutputStream(), problem);
    }

}
