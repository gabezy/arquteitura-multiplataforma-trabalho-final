package br.com.puc.multiplataforma.bffgateway.infra.security;

import br.com.puc.multiplataforma.bffgateway.infra.observability.AuthenticatedUserMdcFilter;
import br.com.puc.multiplataforma.bffgateway.infra.ratelimit.RateLimitFilter;
import br.com.puc.multiplataforma.bffgateway.infra.ratelimit.RateLimiter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.json.JsonMapper;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@EnableConfigurationProperties(KeycloakClientProperties.class)
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectProvider<RateLimiter> rateLimiter,
                                                   JsonMapper jsonMapper) {
        rateLimiter.ifAvailable(limiter ->
                http.addFilterAfter(new RateLimitFilter(limiter, jsonMapper), BearerTokenAuthenticationFilter.class));
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/**", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
                        .anyRequest().authenticated()
                )
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(new KeycloakJwtAuthenticationConverter())))
                .addFilterAfter(new AuthenticatedUserMdcFilter(), BearerTokenAuthenticationFilter.class)
                .build();
    }

}
