package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesConfig.class);

    @Test
    void bindsTheLimit() {
        runner.withPropertyValues("app.rate-limit.requests-per-minute=100")
                .run(context -> assertThat(context.getBean(RateLimitProperties.class).requestsPerMinute()).isEqualTo(100));
    }

    @Test
    void failsWithoutTheLimit() {
        runner.run(context -> assertThat(context).hasFailed());
    }

    @Test
    void failsWithAZeroLimit() {
        runner.withPropertyValues("app.rate-limit.requests-per-minute=0")
                .run(context -> assertThat(context).hasFailed());
    }

    @Configuration
    @EnableConfigurationProperties(RateLimitProperties.class)
    static class PropertiesConfig {
    }
}
