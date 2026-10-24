package br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.gateway.MarketplaceGateway;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.getlisting.GetListing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.usecase.listlistings.ListListings;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.LISTING_ID;
import static br.com.puc.multiplataforma.bffgateway.core.marketplace.ListingFixtures.listing;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

class ListingUseCasesTest {

    private final MarketplaceGateway marketplaceGateway = mock(MarketplaceGateway.class);

    @Test
    void listsTheListingsOfThePageRequestedFromTheGateway() {
        ListingFilter filter = new ListingFilter("OXI-001", Marketplace.AMAZON, ListingStatus.PUBLISHED);
        PageRequest pageRequest = new PageRequest(5, 10);
        Page<Listing> page = new Page<>(List.of(listing()), 5, 10);
        given(marketplaceGateway.list(filter, pageRequest)).willReturn(page);

        Page<Listing> result = new ListListings(marketplaceGateway).execute(filter, pageRequest);

        assertThat(result).isSameAs(page);
    }

    @Test
    void returnsTheListingFoundByTheGateway() {
        given(marketplaceGateway.findById(LISTING_ID)).willReturn(Optional.of(listing()));

        Listing result = new GetListing(marketplaceGateway).execute(LISTING_ID);

        assertThat(result).isEqualTo(listing());
    }

    @Test
    void failsWhenTheListingDoesNotExist() {
        UUID unknownId = UUID.fromString("7a2b9c10-0000-4000-8000-0000000000ff");
        given(marketplaceGateway.findById(unknownId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> new GetListing(marketplaceGateway).execute(unknownId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("listing '7a2b9c10-0000-4000-8000-0000000000ff' not found");
    }

}
