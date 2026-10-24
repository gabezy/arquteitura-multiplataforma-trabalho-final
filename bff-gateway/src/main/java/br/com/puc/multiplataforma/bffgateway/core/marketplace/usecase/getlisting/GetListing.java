package br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;

import java.util.UUID;

public class GetListing {

    private final MarketplaceGateway marketplaceGateway;

    public GetListing(MarketplaceGateway marketplaceGateway) {
        this.marketplaceGateway = marketplaceGateway;
    }

    public Listing execute(UUID id) {
        return marketplaceGateway.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("listing", id));
    }

}
