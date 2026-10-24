package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Objects;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ListingPagePayload(List<ListingPayload> listings, int limit, int offset) {

    public Page<Listing> toDomain() {
        List<Listing> items = Objects.requireNonNullElse(listings, List.<ListingPayload>of()).stream()
                .map(ListingPayload::toDomain)
                .toList();
        return new Page<>(items, limit, offset);
    }

}
