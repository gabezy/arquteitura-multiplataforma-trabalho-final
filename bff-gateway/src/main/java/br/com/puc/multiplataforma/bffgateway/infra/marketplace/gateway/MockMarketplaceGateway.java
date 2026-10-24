package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class MockMarketplaceGateway implements MarketplaceGateway {

    private static final BigDecimal OXIMETER_PRICE = new BigDecimal("189.90");
    private static final BigDecimal MONITOR_PRICE = new BigDecimal("18500.00");

    private static final List<Listing> LISTINGS = List.of(
            published("01", "OXI-001", Marketplace.AMAZON, "AMZ-LST-OXI-001", OXIMETER_PRICE, 2, "2026-10-27T10:00:05Z"),
            published("02", "OXI-001", Marketplace.MERCADO_LIVRE, "MLB-LST-OXI-001", OXIMETER_PRICE, 2, "2026-10-27T10:00:07Z"),
            failed("03", "OXI-001", Marketplace.SHOPEE, OXIMETER_PRICE, 2, "HTTP 503 after retries", "2026-10-27T10:00:21Z"),
            published("04", "MON-002", Marketplace.AMAZON, "AMZ-LST-MON-002", MONITOR_PRICE, 5, "2026-10-27T10:00:06Z"),
            pending("05", "MON-002", Marketplace.MERCADO_LIVRE, MONITOR_PRICE, 5, "2026-10-27T10:00:08Z"),
            published("06", "MON-002", Marketplace.SHOPEE, "SP-LST-MON-002", MONITOR_PRICE, 5, "2026-10-27T10:00:09Z")
    );

    @Override
    public Page<Listing> list(ListingFilter filter, PageRequest pageRequest) {
        List<Listing> items = LISTINGS.stream()
                .filter(listing -> filter.sku() == null || listing.sku().equalsIgnoreCase(filter.sku()))
                .filter(listing -> filter.marketplace() == null || listing.marketplace() == filter.marketplace())
                .filter(listing -> filter.status() == null || listing.status() == filter.status())
                .sorted(Comparator.comparing(Listing::sku).thenComparing(Listing::marketplace))
                .skip(pageRequest.offset())
                .limit(pageRequest.limit())
                .toList();
        return new Page<>(items, pageRequest.limit(), pageRequest.offset());
    }

    @Override
    public Optional<Listing> findById(UUID id) {
        return LISTINGS.stream()
                .filter(listing -> listing.id().equals(id))
                .findFirst();
    }

    private static Listing published(String number, String sku, Marketplace marketplace, String externalListingId,
                                     BigDecimal price, int stock, String updatedAt) {
        return listing(number, sku, marketplace, externalListingId, ListingStatus.PUBLISHED, price, stock, null, updatedAt);
    }

    private static Listing failed(String number, String sku, Marketplace marketplace, BigDecimal price, int stock,
                                  String failureReason, String updatedAt) {
        return listing(number, sku, marketplace, null, ListingStatus.FAILED, price, stock, failureReason, updatedAt);
    }

    private static Listing pending(String number, String sku, Marketplace marketplace, BigDecimal price, int stock,
                                   String updatedAt) {
        return listing(number, sku, marketplace, null, ListingStatus.PENDING, price, stock, null, updatedAt);
    }

    private static Listing listing(String number, String sku, Marketplace marketplace, String externalListingId,
                                   ListingStatus status, BigDecimal price, int stock, String failureReason,
                                   String updatedAt) {
        return new Listing(UUID.fromString("7a2b9c10-0000-4000-8000-0000000000" + number), sku, marketplace,
                externalListingId, status, price, stock, failureReason, Instant.parse(updatedAt));
    }

}
