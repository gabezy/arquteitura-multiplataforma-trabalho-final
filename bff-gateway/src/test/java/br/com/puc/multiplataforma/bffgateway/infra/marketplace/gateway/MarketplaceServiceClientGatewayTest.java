package br.com.puc.multiplataforma.bffgateway.infra.marketplace.gateway;

import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingFilter;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.ListingStatus;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Marketplace;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.PageRequest;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class MarketplaceServiceClientGatewayTest {

    private static final String BASE_URL = "http://marketplace-gateway:8087";
    private static final String LISTING_ID = "7a2b9c10-0000-4000-8000-000000000003";
    private static final String LISTING_JSON = """
            {
              "id": "7a2b9c10-0000-4000-8000-000000000003",
              "sku": "OXI-001",
              "marketplace": "SHOPEE",
              "externalListingId": null,
              "status": "FAILED",
              "price": 189.90,
              "stock": 2,
              "failureReason": "HTTP 503 after retries",
              "updatedAt": "2026-10-27T10:00:21Z",
              "somethingNew": "fields the BFF does not know are ignored"
            }""";

    private final RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final MarketplaceServiceClientGateway gateway =
            new MarketplaceServiceClientGateway(new DownstreamClient("marketplace-gateway", builder.build()));

    @Test
    void listsListingsWithTheFiltersAndThePagination() {
        server.expect(requestTo(BASE_URL + "/listings?sku=OXI-001&marketplace=SHOPEE&status=FAILED&limit=5&offset=10"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {"listings": [%s], "limit": 5, "offset": 10}""".formatted(LISTING_JSON), MediaType.APPLICATION_JSON));

        Page<Listing> page = gateway.list(new ListingFilter("OXI-001", Marketplace.SHOPEE, ListingStatus.FAILED),
                new PageRequest(5, 10));

        assertThat(page.limit()).isEqualTo(5);
        assertThat(page.offset()).isEqualTo(10);
        assertThat(page.items()).singleElement().satisfies(listing -> {
            assertThat(listing.id()).isEqualTo(UUID.fromString(LISTING_ID));
            assertThat(listing.sku()).isEqualTo("OXI-001");
            assertThat(listing.marketplace()).isEqualTo(Marketplace.SHOPEE);
            assertThat(listing.externalListingId()).isNull();
            assertThat(listing.status()).isEqualTo(ListingStatus.FAILED);
            assertThat(listing.price()).isEqualByComparingTo("189.90");
            assertThat(listing.stock()).isEqualTo(2);
            assertThat(listing.failureReason()).isEqualTo("HTTP 503 after retries");
            assertThat(listing.updatedAt()).isEqualTo(Instant.parse("2026-10-27T10:00:21Z"));
        });
        server.verify();
    }

    @Test
    void omitsTheFiltersThatWereNotInformed() {
        server.expect(requestTo(BASE_URL + "/listings?limit=20&offset=0"))
                .andRespond(withSuccess("{\"listings\": [], \"limit\": 20, \"offset\": 0}", MediaType.APPLICATION_JSON));

        Page<Listing> page = gateway.list(new ListingFilter(null, null, null), PageRequest.of(null, null));

        assertThat(page.items()).isEmpty();
        server.verify();
    }

    @Test
    void treatsAMissingListAsEmpty() {
        server.expect(requestTo(BASE_URL + "/listings?limit=20&offset=0"))
                .andRespond(withSuccess("{\"limit\": 20, \"offset\": 0}", MediaType.APPLICATION_JSON));

        assertThat(gateway.list(new ListingFilter(null, null, null), PageRequest.of(null, null)).items()).isEmpty();
    }

    @Test
    void findsAListingById() {
        server.expect(requestTo(BASE_URL + "/listings/" + LISTING_ID))
                .andRespond(withSuccess(LISTING_JSON, MediaType.APPLICATION_JSON));

        assertThat(gateway.findById(UUID.fromString(LISTING_ID)))
                .hasValueSatisfying(listing -> assertThat(listing.failureReason()).isEqualTo("HTTP 503 after retries"));
        server.verify();
    }

    @Test
    void findsNothingWhenTheMarketplaceGatewayDoesNotKnowTheListing() {
        server.expect(requestTo(BASE_URL + "/listings/" + LISTING_ID)).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(gateway.findById(UUID.fromString(LISTING_ID))).isEmpty();
    }

    @Test
    void failsWhenTheMarketplaceGatewayReturnsAStatusTheBffDoesNotKnow() {
        server.expect(requestTo(BASE_URL + "/listings/" + LISTING_ID))
                .andRespond(withSuccess(LISTING_JSON.replace("FAILED", "SUSPENDED"), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> gateway.findById(UUID.fromString(LISTING_ID)))
                .isInstanceOf(DownstreamFailureException.class);
    }

    @Test
    void failsWhenTheMarketplaceGatewayIsUnavailable() {
        server.expect(requestTo(BASE_URL + "/listings?limit=20&offset=0"))
                .andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> gateway.list(new ListingFilter(null, null, null), PageRequest.of(null, null)))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("marketplace-gateway is unavailable");
    }

}
