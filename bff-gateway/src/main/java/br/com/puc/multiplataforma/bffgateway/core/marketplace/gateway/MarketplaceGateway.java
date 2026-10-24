package br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.util.Optional;
import java.util.UUID;

public interface MarketplaceGateway {

    Page<Listing> list(ListingFilter filter, PageRequest pageRequest);

    Optional<Listing> findById(UUID id);

}
