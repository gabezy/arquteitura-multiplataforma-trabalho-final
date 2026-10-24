package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway.model;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ListingPayload(
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

    public Listing toDomain() {
        return new Listing(id, sku, marketplace, externalListingId, status, price, stock, failureReason, updatedAt);
    }

}
