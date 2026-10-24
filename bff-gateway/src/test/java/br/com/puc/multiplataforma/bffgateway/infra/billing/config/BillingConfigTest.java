package br.com.puc.multiplataforma.bffgateway.infra.billing.config;

import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.BillingServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.MockBillingGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.web.client.RestClient;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class BillingConfigTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(BillingConfig.class)
            .withBean(DownstreamClientFactory.class,
                    () -> new DownstreamClientFactory(RestClient.builder(), Duration.ofSeconds(1), Duration.ofSeconds(1)))
            .withPropertyValues("billing-service.url=http://billing-service:8086");

    @Test
    void callsTheBillingServiceByDefault() {
        contextRunner.run(context -> assertThat(context).getBean(BillingGateway.class)
                .isInstanceOf(BillingServiceClientGateway.class));
    }

    @Test
    void callsTheBillingServiceWhenTheGatewayIsRest() {
        contextRunner.withPropertyValues("app.gateways.billing=rest")
                .run(context -> assertThat(context).getBean(BillingGateway.class)
                        .isInstanceOf(BillingServiceClientGateway.class));
    }

    @Test
    void usesTheMockWhenTheGatewayIsMock() {
        contextRunner.withPropertyValues("app.gateways.billing=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(BillingGateway.class);
                    assertThat(context).getBean(BillingGateway.class).isInstanceOf(MockBillingGateway.class);
                });
    }

    @Test
    void failsToStartWhenTheGatewayIsNeitherMockNorRest() {
        contextRunner.withPropertyValues("app.gateways.billing=soap")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void wiresTheUseCasesWithTheGateway() {
        contextRunner.withPropertyValues("app.gateways.billing=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(ListInvoices.class);
                    assertThat(context).hasSingleBean(GetInvoice.class);
                });
    }

}
