package br.com.puc.multiplataforma.bffgateway.infra.shared.config;

import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.web.client.RestClient;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class DownstreamConfigTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(DownstreamConfig.class)
            .withBean(RestClient.Builder.class, RestClient::builder);

    @Test
    void createsTheClientFactoryWithTheDefaultTimeouts() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(DownstreamClientFactory.class);
            assertThat(context.getBean(DownstreamProperties.class))
                    .isEqualTo(new DownstreamProperties(Duration.ofSeconds(2), Duration.ofSeconds(10)));
        });
    }

    @Test
    void bindsTheConfiguredTimeouts() {
        contextRunner
                .withPropertyValues("downstream.connect-timeout=500ms", "downstream.read-timeout=3s")
                .run(context -> assertThat(context.getBean(DownstreamProperties.class))
                        .isEqualTo(new DownstreamProperties(Duration.ofMillis(500), Duration.ofSeconds(3))));
    }

}
