package br.com.puc.multiplataforma.bffgateway.infra.order.config;

import br.com.puc.multiplataforma.bffgateway.core.order.gateway.OrderGateway;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.getorder.GetOrder;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.listorders.ListOrders;
import br.com.puc.multiplataforma.bffgateway.core.order.usecase.salesreport.GetSalesByMarketplace;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.MockOrderGateway;
import br.com.puc.multiplataforma.bffgateway.infra.order.gateway.OrderServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OrderConfig {

    @Bean
    @ConditionalOnProperty(name = "app.gateways.order", havingValue = "mock")
    public OrderGateway mockOrderGateway() {
        return new MockOrderGateway();
    }

    @Bean
    @ConditionalOnProperty(name = "app.gateways.order", havingValue = "rest", matchIfMissing = true)
    public OrderGateway orderServiceClientGateway(DownstreamClientFactory downstreamClients,
                                                  @Value("${order-service.url}") String orderServiceUrl) {
        return new OrderServiceClientGateway(downstreamClients.create("order-service", orderServiceUrl));
    }

    @Bean
    public ListOrders listOrders(OrderGateway orderGateway) {
        return new ListOrders(orderGateway);
    }

    @Bean
    public GetOrder getOrder(OrderGateway orderGateway) {
        return new GetOrder(orderGateway);
    }

    @Bean
    public GetSalesByMarketplace getSalesByMarketplace(OrderGateway orderGateway) {
        return new GetSalesByMarketplace(orderGateway);
    }

}
