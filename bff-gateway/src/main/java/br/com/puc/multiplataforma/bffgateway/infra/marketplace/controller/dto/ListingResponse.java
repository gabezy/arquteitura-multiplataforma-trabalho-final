package br.com.puc.multiplataforma.bffgateway.infra.marketplace.controller.dto;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ListingResponse(
        UUID id,
        String sku,
        Marketplace marketplace,
        String externalListingId,
        ListingStatus status,
        BigDecimal price,
        int stock,
        String failureReason,
        Instant updatedAt
) {

    public static ListingResponse from(Listing listing) {
        return new ListingResponse(
                listing.id(),
                listing.sku(),
                listing.marketplace(),
                listing.externalListingId(),
                listing.status(),
                listing.price(),
                listing.stock(),
                listing.failureReason(),
                listing.updatedAt()
        );
    }

}
