package br.com.puc.multiplataforma.bffgateway.infra.order.config;

import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.MockOrderGateway;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.OrderServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.web.client.RestClient;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class OrderConfigTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(OrderConfig.class)
            .withBean(DownstreamClientFactory.class,
                    () -> new DownstreamClientFactory(RestClient.builder(), Duration.ofSeconds(1), Duration.ofSeconds(1)))
            .withPropertyValues("order-service.url=http://order-service:8084");

    @Test
    void callsTheOrderServiceByDefault() {
        contextRunner.run(context -> assertThat(context).getBean(OrderGateway.class)
                .isInstanceOf(OrderServiceClientGateway.class));
    }

    @Test
    void callsTheOrderServiceWhenTheGatewayIsRest() {
        contextRunner.withPropertyValues("app.gateways.order=rest")
                .run(context -> assertThat(context).getBean(OrderGateway.class)
                        .isInstanceOf(OrderServiceClientGateway.class));
    }

    @Test
    void usesTheMockWhenTheGatewayIsMock() {
        contextRunner.withPropertyValues("app.gateways.order=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(OrderGateway.class);
                    assertThat(context).getBean(OrderGateway.class).isInstanceOf(MockOrderGateway.class);
                });
    }

    @Test
    void failsToStartWhenTheGatewayIsNeitherMockNorRest() {
        contextRunner.withPropertyValues("app.gateways.order=soap")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void wiresTheUseCasesWithTheGateway() {
        contextRunner.withPropertyValues("app.gateways.order=mock")
                .run(context -> {
                    assertThat(context).hasSingleBean(ListOrders.class);
                    assertThat(context).hasSingleBean(GetOrder.class);
                    assertThat(context).hasSingleBean(GetSalesByMarketplace.class);
                });
    }

}
