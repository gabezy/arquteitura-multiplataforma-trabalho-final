package br.com.puc.multiplataforma.bffgateway.infra.marketplace.config;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.MarketplaceServiceClientGateway;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.MockMarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MarketplaceConfig {

    @Bean
    @ConditionalOnProperty(name = "app.gateways.marketplace", havingValue = "mock")
    public MarketplaceGateway mockMarketplaceGateway() {
        return new MockMarketplaceGateway();
    }

    @Bean
    @ConditionalOnProperty(name = "app.gateways.marketplace", havingValue = "rest", matchIfMissing = true)
    public MarketplaceGateway marketplaceServiceClientGateway(DownstreamClientFactory downstreamClients,
                                                              @Value("${marketplace-gateway.url}") String marketplaceGatewayUrl) {
        return new MarketplaceServiceClientGateway(downstreamClients.create("marketplace-gateway", marketplaceGatewayUrl));
    }

    @Bean
    public ListListings listListings(MarketplaceGateway marketplaceGateway) {
        return new ListListings(marketplaceGateway);
    }

    @Bean
    public GetListing getListing(MarketplaceGateway marketplaceGateway) {
        return new GetListing(marketplaceGateway);
    }

}
