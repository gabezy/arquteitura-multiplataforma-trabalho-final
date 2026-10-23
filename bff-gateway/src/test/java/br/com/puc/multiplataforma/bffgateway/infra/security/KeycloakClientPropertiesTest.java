package br.com.puc.multiplataforma.bffgateway.infra.security;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class KeycloakClientPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesConfig.class);

    @Test
    void bindsTheClientSecret() {
        runner.withPropertyValues("keycloak.client-secret=abc")
                .run(context -> assertThat(context.getBean(KeycloakClientProperties.class).clientSecret())
                        .isEqualTo("abc"));
    }

    @Test
    void failsWithoutTheClientSecret() {
        runner.run(context -> assertThat(context).hasFailed());
    }

    @Configuration
    @EnableConfigurationProperties(KeycloakClientProperties.class)
    static class PropertiesConfig {
    }
}
