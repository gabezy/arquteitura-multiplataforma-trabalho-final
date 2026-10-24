package br.com.puc.multiplataforma.bffgateway.core.marketplace.domain;

import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record Listing(
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
}
