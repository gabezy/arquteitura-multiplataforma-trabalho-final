package br.com.puc.multiplataforma.bffgateway.infra.security;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Credentials of the {@code bff-gateway} client in Keycloak, read from Vault ({@code secret/bff-gateway}).
 * Startup fails without them.
 */
@Validated
@ConfigurationProperties("keycloak")
public record KeycloakClientProperties(@NotBlank String clientSecret) {
}
