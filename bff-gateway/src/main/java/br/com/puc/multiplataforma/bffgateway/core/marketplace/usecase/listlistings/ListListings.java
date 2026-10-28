package br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

public class ListListings {

    private final MarketplaceGateway marketplaceGateway;

    public ListListings(MarketplaceGateway marketplaceGateway) {
        this.marketplaceGateway = marketplaceGateway;
    }

    public Page<Listing> execute(ListingFilter filter, PageRequest pageRequest) {
        return marketplaceGateway.list(filter, pageRequest);
    }

}
