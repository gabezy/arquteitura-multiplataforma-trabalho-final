package br.com.puc.multiplataforma.bffgateway.infra.security;

import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

public final class TestTokens {

    private TestTokens() {
    }

    public static JwtRequestPostProcessor withRole(String role) {
        return jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role));
    }

    public static Jwt keycloakJwt(String tokenValue, String... roles) {
        return Jwt.withTokenValue(tokenValue)
                .header("alg", "none")
                .subject("user-id")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("scope", "openid profile email")
                .claim("realm_access", Map.of("roles", List.of(roles)))
                .claim("preferred_username", "testuser")
                .build();
    }

}
