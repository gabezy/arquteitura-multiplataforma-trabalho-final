package br.com.puc.multiplataforma.bffgateway.infra.marketplace.config;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.MarketplaceServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.MockMarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.web.client.RestClient;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class MarketplaceConfigTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(MarketplaceConfig.class)
            .withBean(DownstreamClientFactory.class,
                    () -> new DownstreamClientFactory(RestClient.builder(), Duration.ofSeconds(1), Duration.ofSeconds(1)))
            .withPropertyValues("marketplace-gateway.url=http://marketplace-gateway:8087");

    @Test
    void callsTheMarketplaceGatewayByDefault() {
        contextRunner.run(context -> assertThat(context).getBean(MarketplaceGateway.class)
                .isInstanceOf(MarketplaceServiceClientGateway.class));
    }

    @Test
    void callsTheMarketplaceGatewayWhenTheGatewayIsRest() {
        contextRunner.withPropertyValues("app.gateways.marketplace=rest")
                .run(context -> assertThat(context).getBean(MarketplaceGateway.class)
                        .isInstanceOf(MarketplaceServiceClientGateway.class));
    }

    @Test
    void usesTheMockWhenTheGatewayIsMock() {
        contextRunner.withPropertyValues("app.gateways.marketplace=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(MarketplaceGateway.class);
                    assertThat(context).getBean(MarketplaceGateway.class).isInstanceOf(MockMarketplaceGateway.class);
                });
    }

    @Test
    void failsToStartWhenTheGatewayIsNeitherMockNorRest() {
        contextRunner.withPropertyValues("app.gateways.marketplace=soap")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void wiresTheUseCasesWithTheGateway() {
        contextRunner.withPropertyValues("app.gateways.marketplace=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(ListListings.class);
                    assertThat(context).hasSingleBean(GetListing.class);
                });
    }

}
