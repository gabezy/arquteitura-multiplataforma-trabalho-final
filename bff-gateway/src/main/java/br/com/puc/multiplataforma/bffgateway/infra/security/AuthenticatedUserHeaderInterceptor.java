package br.com.puc.multiplataforma.bffgateway.infra.security;

import org.jspecify.annotations.NonNull;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.io.IOException;

public class AuthenticatedUserHeaderInterceptor implements ClientHttpRequestInterceptor {

    private static final String USER_ID_HEADER = "X-User-Id";

    @Override
    public @NonNull ClientHttpResponse intercept(@NonNull HttpRequest request, byte @NonNull [] body,
                                                 @NonNull ClientHttpRequestExecution execution) throws IOException {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token) {
            request.getHeaders().add(USER_ID_HEADER, token.getToken().getSubject());
        }

        return execution.execute(request, body);
    }
}
