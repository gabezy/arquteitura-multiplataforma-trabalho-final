package br.com.puc.multiplataforma.bffgateway.infra.billing.config;

import br.com.puc.multiplataforma.bffgateway.core.billing.gateway.BillingGateway;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.getinvoice.GetInvoice;
import br.com.puc.multiplataforma.bffgateway.core.billing.usecase.listinvoices.ListInvoices;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.BillingServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.billing.gateway.MockBillingGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BillingConfig {

    @Bean
    @ConditionalOnProperty(name = "app.gateways.billing", havingValue = "mock")
    public BillingGateway mockBillingGateway() {
        return new MockBillingGateway();
    }

    @Bean
    @ConditionalOnProperty(name = "app.gateways.billing", havingValue = "rest", matchIfMissing = true)
    public BillingGateway billingServiceClientGateway(DownstreamClientFactory downstreamClients,
                                                      @Value("${billing-service.url}") String billingServiceUrl) {
        return new BillingServiceClientGateway(downstreamClients.create("billing-service", billingServiceUrl));
    }

    @Bean
    public ListInvoices listInvoices(BillingGateway billingGateway) {
        return new ListInvoices(billingGateway);
    }

    @Bean
    public GetInvoice getInvoice(BillingGateway billingGateway) {
        return new GetInvoice(billingGateway);
    }

}
