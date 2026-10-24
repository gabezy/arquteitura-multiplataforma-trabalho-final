package br.com.puc.multiplataforma.bffgateway.core.marketplace;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class ListingFixtures {

    public static final UUID LISTING_ID = UUID.fromString("7a2b9c10-0000-4000-8000-000000000001");

    private ListingFixtures() {
    }

    public static Listing listing() {
        return new Listing(
                LISTING_ID,
                "OXI-001",
                Marketplace.AMAZON,
                "AMZ-LST-OXI-001",
                ListingStatus.PUBLISHED,
                new BigDecimal("189.90"),
                2,
                null,
                Instant.parse("2026-10-27T10:00:05Z")
        );
    }

}
