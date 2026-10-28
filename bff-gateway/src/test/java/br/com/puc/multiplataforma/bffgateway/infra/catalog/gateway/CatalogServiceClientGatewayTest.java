package br.com.puc.multiplataforma.bffgateway.infra.catalog.gateway;

import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.NewProduct;
import br.com.puc.multiplataforma.bffgateway.core.catalog.domain.PriceChange;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClient;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

class CatalogServiceClientGatewayTest {

    private static final String BASE_URL = "http://catalog-service:8082";
    private static final PriceChange PRICE_CHANGE = new PriceChange("NB-001", new BigDecimal("4999.90"));

    private final RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final CatalogServiceClientGateway gateway = new CatalogServiceClientGateway(
            new DownstreamClient("catalog-service", builder.build()), new CatalogGatewayMapperImpl());

    @Test
    void importsTheProducts() {
        server.expect(requestTo(BASE_URL + "/products/import"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                        {"items": [{"sku": "NB-001", "name": "Notebook", "description": "", "price": 4500.0, "stock": 3}]}"""))
                .andRespond(withStatus(HttpStatus.CREATED));

        gateway.importProducts(List.of(new NewProduct("NB-001", "Notebook", "", new BigDecimal("4500.00"), 3)));

        server.verify();
    }

    @Test
    void changesThePriceOfTheSku() {
        server.expect(requestTo(BASE_URL + "/products/sku/NB-001/price"))
                .andExpect(method(HttpMethod.PATCH))
                .andExpect(content().json("{\"price\": 4999.90}"))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        assertThat(gateway.changePrice(PRICE_CHANGE)).isTrue();
        server.verify();
    }

    @Test
    void encodesTheSkuInThePath() {
        server.expect(requestTo(BASE_URL + "/products/sku/NB%2F001/price"))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        gateway.changePrice(new PriceChange("NB/001", BigDecimal.ONE));

        server.verify();
    }

    @Test
    void changesNothingWhenTheCatalogDoesNotKnowTheSku() {
        server.expect(requestTo(BASE_URL + "/products/sku/NB-001/price")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(gateway.changePrice(PRICE_CHANGE)).isFalse();
    }

    @Test
    void forwardsTheDetailWhenTheCatalogRejectsThePrice() {
        server.expect(requestTo(BASE_URL + "/products/sku/NB-001/price"))
                .andRespond(withStatus(HttpStatusCode.valueOf(422))
                        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\": 422, \"detail\": \"Price must be a non-negative number\"}"));

        assertThatThrownBy(() -> gateway.changePrice(PRICE_CHANGE))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("Price must be a non-negative number");
    }

    @Test
    void failsWhenTheCatalogIsUnavailable() {
        server.expect(requestTo(BASE_URL + "/products/sku/NB-001/price"))
                .andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> gateway.changePrice(PRICE_CHANGE))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("catalog-service is unavailable");
    }

}
