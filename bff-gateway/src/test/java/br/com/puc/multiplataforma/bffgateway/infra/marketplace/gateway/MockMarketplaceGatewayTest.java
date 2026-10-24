package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class MockMarketplaceGatewayTest {

    private static final ListingFilter NO_FILTER = new ListingFilter(null, null, null);

    private final MockMarketplaceGateway gateway = new MockMarketplaceGateway();

    @Test
    void listsTheListingsOfEachProductInEveryMarketplace() {
        Page<Listing> page = gateway.list(NO_FILTER, PageRequest.of(null, null));

        assertThat(page.items()).extracting(Listing::sku, Listing::marketplace).containsExactly(
                tuple("MON-002", Marketplace.AMAZON),
                tuple("MON-002", Marketplace.MERCADO_LIVRE),
                tuple("MON-002", Marketplace.SHOPEE),
                tuple("OXI-001", Marketplace.AMAZON),
                tuple("OXI-001", Marketplace.MERCADO_LIVRE),
                tuple("OXI-001", Marketplace.SHOPEE));
        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.offset()).isZero();
    }

    @Test
    void coversEveryListingStatus() {
        List<Listing> listings = gateway.list(NO_FILTER, PageRequest.of(null, null)).items();

        assertThat(listings).extracting(Listing::status).contains(
                ListingStatus.PUBLISHED, ListingStatus.FAILED, ListingStatus.PENDING);
    }

    @Test
    void filtersBySkuIgnoringTheCase() {
        Page<Listing> page = gateway.list(new ListingFilter("oxi-001", null, null), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Listing::sku).containsOnly("OXI-001").hasSize(3);
    }

    @Test
    void filtersByMarketplace() {
        Page<Listing> page = gateway.list(new ListingFilter(null, Marketplace.SHOPEE, null), PageRequest.of(null, null));

        assertThat(page.items()).extracting(Listing::sku).containsExactly("MON-002", "OXI-001");
    }

    @Test
    void filtersByStatus() {
        Page<Listing> page = gateway.list(new ListingFilter(null, null, ListingStatus.FAILED), PageRequest.of(null, null));

        assertThat(page.items()).singleElement().satisfies(listing -> {
            assertThat(listing.sku()).isEqualTo("OXI-001");
            assertThat(listing.marketplace()).isEqualTo(Marketplace.SHOPEE);
            assertThat(listing.failureReason()).isEqualTo("HTTP 503 after retries");
            assertThat(listing.externalListingId()).isNull();
        });
    }

    @Test
    void combinesTheFilters() {
        Page<Listing> page = gateway.list(
                new ListingFilter("MON-002", Marketplace.MERCADO_LIVRE, ListingStatus.PENDING), PageRequest.of(null, null));

        assertThat(page.items()).hasSize(1);
        assertThat(gateway.list(new ListingFilter("MON-002", Marketplace.MERCADO_LIVRE, ListingStatus.PUBLISHED),
                PageRequest.of(null, null)).items()).isEmpty();
    }

    @Test
    void paginatesWithLimitAndOffset() {
        Page<Listing> all = gateway.list(NO_FILTER, PageRequest.of(null, null));

        Page<Listing> page = gateway.list(NO_FILTER, new PageRequest(2, 4));

        assertThat(page.items()).containsExactlyElementsOf(all.items().subList(4, 6));
        assertThat(page.limit()).isEqualTo(2);
        assertThat(page.offset()).isEqualTo(4);
    }

    @Test
    void returnsAnEmptyPageBeyondTheLastListing() {
        assertThat(gateway.list(NO_FILTER, new PageRequest(20, 6)).items()).isEmpty();
    }

    @Test
    void findsAListingById() {
        UUID id = UUID.fromString("7a2b9c10-0000-4000-8000-000000000001");

        assertThat(gateway.findById(id)).hasValueSatisfying(listing -> {
            assertThat(listing.sku()).isEqualTo("OXI-001");
            assertThat(listing.marketplace()).isEqualTo(Marketplace.AMAZON);
            assertThat(listing.status()).isEqualTo(ListingStatus.PUBLISHED);
            assertThat(listing.externalListingId()).isEqualTo("AMZ-LST-OXI-001");
            assertThat(listing.price()).isEqualByComparingTo("189.90");
            assertThat(listing.stock()).isEqualTo(2);
            assertThat(listing.failureReason()).isNull();
        });
    }

    @Test
    void returnsNothingForAnUnknownId() {
        assertThat(gateway.findById(UUID.fromString("7a2b9c10-0000-4000-8000-0000000000ff"))).isEmpty();
    }

    @Test
    void onlyPublishedListingsHaveAnExternalId() {
        List<Listing> listings = gateway.list(NO_FILTER, PageRequest.of(null, null)).items();

        assertThat(listings).allSatisfy(listing -> {
            if (listing.status() == ListingStatus.PUBLISHED) {
                assertThat(listing.externalListingId()).isNotBlank();
            } else {
                assertThat(listing.externalListingId()).isNull();
            }
        });
    }

}
