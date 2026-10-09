package br.com.puc.multiplataforma.bffgateway.infra.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class KeycloakJwtAuthenticationConverterTest {

    private final KeycloakJwtAuthenticationConverter converter = new KeycloakJwtAuthenticationConverter();

    @Test
    void mapsScopesAndRealmRolesToAuthorities() {
        Jwt jwt = jwtBuilder()
                .claim("scope", "openid catalog:write")
                .claim("realm_access", Map.of("roles", List.of("customer", "admin")))
                .build();

        AbstractAuthenticationToken token = converter.convert(jwt);

        assertThat(token).isNotNull();
        assertThat(authorities(token))
                .containsExactlyInAnyOrder("SCOPE_openid", "SCOPE_catalog:write", "ROLE_customer", "ROLE_admin");
    }

    @Test
    void returnsOnlyScopesWhenRealmAccessIsMissing() {
        Jwt jwt = jwtBuilder()
                .claim("scope", "openid")
                .build();

        assertThat(authorities(converter.convert(jwt))).containsExactly("SCOPE_openid");
    }

    @Test
    void ignoresRealmAccessWithoutRoles() {
        Jwt jwt = jwtBuilder()
                .claim("scope", "openid")
                .claim("realm_access", Map.of("other", "value"))
                .build();

        assertThat(authorities(converter.convert(jwt))).containsExactly("SCOPE_openid");
    }

    @Test
    void usesPreferredUsernameAsPrincipalName() {
        Jwt jwt = jwtBuilder()
                .claim("preferred_username", "admin")
                .build();

        assertThat(converter.convert(jwt).getName()).isEqualTo("admin");
    }

    private static Jwt.Builder jwtBuilder() {
        return Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("user-id");
    }

    private static List<String> authorities(AbstractAuthenticationToken token) {
        return token.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .toList();
    }

}
