package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.infra.cache.CacheNames;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.model.ListingPagePayload;
import br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.model.ListingPayload;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;
import org.springframework.cache.annotation.Cacheable;

import java.util.Optional;
import java.util.UUID;

public class MarketplaceServiceClientGateway implements MarketplaceGateway {

    private final DownstreamClient marketplaceGateway;

    public MarketplaceServiceClientGateway(DownstreamClient marketplaceGateway) {
        this.marketplaceGateway = marketplaceGateway;
    }

    @Override
    @Cacheable(cacheNames = CacheNames.LISTINGS, key = "#filter.toString() + ':' + #pageRequest.toString()")
    public Page<Listing> list(ListingFilter filter, PageRequest pageRequest) {
        return marketplaceGateway.get(uri -> uri
                        .path("/listings")
                        .queryParamIfPresent("sku", Optional.ofNullable(filter.sku()))
                        .queryParamIfPresent("marketplace", Optional.ofNullable(filter.marketplace()))
                        .queryParamIfPresent("status", Optional.ofNullable(filter.status()))
                        .queryParam("limit", pageRequest.limit())
                        .queryParam("offset", pageRequest.offset())
                        .build(),
                ListingPagePayload.class).toDomain();
    }

    @Override
    @Cacheable(cacheNames = CacheNames.LISTING, key = "#id", unless = "#result == null")
    public Optional<Listing> findById(UUID id) {
        return marketplaceGateway.find(uri -> uri.path("/listings/{id}").build(id), ListingPayload.class)
                .map(ListingPayload::toDomain);
    }

}
