package br.com.puc.multiplataforma.bffgateway.infra.shared.gateway;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class DownstreamClientTest {

    private static final String BASE_URL = "http://order-service:8084";
    private static final String GREETING = "{\"message\":\"hi\"}";

    private final RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final DownstreamClient client = new DownstreamClient("order-service", builder.build());

    @Test
    void getsTheBodyOfTheResponse() {
        server.expect(requestTo(BASE_URL + "/greetings"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(GREETING, MediaType.APPLICATION_JSON));

        Greeting greeting = client.get(uri -> uri.path("/greetings").build(), Greeting.class);

        assertThat(greeting.message()).isEqualTo("hi");
        server.verify();
    }

    @Test
    void findsTheBodyOfTheResponse() {
        server.expect(requestTo(BASE_URL + "/greetings/1"))
                .andRespond(withSuccess(GREETING, MediaType.APPLICATION_JSON));

        assertThat(client.find(uri -> uri.path("/greetings/{id}").build(1), Greeting.class))
                .hasValue(new Greeting("hi"));
    }

    @Test
    void findsNothingWhenTheServiceAnswersNotFound() {
        server.expect(requestTo(BASE_URL + "/greetings/1")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(client.find(uri -> uri.path("/greetings/{id}").build(1), Greeting.class)).isEmpty();
    }

    @Test
    void treatsNotFoundAsAnUnexpectedResponseWhenGettingACollection() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: HTTP 404");
    }

    @Test
    void translatesAProblemDetailRejectionIntoAnInvalidRequest() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body("{\"type\":\"about:blank\",\"title\":\"Bad Request\",\"status\":400,\"detail\":\"limit must be at most 100\"}"));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("limit must be at most 100");
    }

    @Test
    void translatesARejectionWithoutDetailIntoAnInvalidRequest() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatusCode.valueOf(422)));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("order-service rejected the request");
    }

    @ParameterizedTest
    @ValueSource(ints = {502, 503, 504})
    void treatsAGatewayErrorOfTheServiceAsUnavailable(int status) {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatusCode.valueOf(status)));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOfSatisfying(DownstreamUnavailableException.class,
                        exception -> assertThat(exception.getService()).isEqualTo("order-service"))
                .hasMessage("order-service is unavailable");
    }

    @Test
    void treatsAServerErrorAsAnUnexpectedResponse() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: HTTP 500");
    }

    @Test
    void treatsAClientErrorThatIsNotARejectionAsAnUnexpectedResponse() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: HTTP 401");
    }

    @Test
    void treatsAnIoErrorAsUnavailable() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("order-service is unavailable");
    }

    @Test
    void treatsAnIoErrorAsUnavailableWhenFindingToo() {
        server.expect(requestTo(BASE_URL + "/greetings/1")).andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> client.find(uri -> uri.path("/greetings/{id}").build(1), Greeting.class))
                .isInstanceOf(DownstreamUnavailableException.class);
    }

    @Test
    void treatsABodyThatIsNotJsonAsAnUnreadableResponse() {
        server.expect(requestTo(BASE_URL + "/greetings"))
                .andRespond(withSuccess("not json", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: unreadable response");
    }

    @Test
    void treatsAnUnsupportedContentTypeAsAnUnreadableResponse() {
        server.expect(requestTo(BASE_URL + "/greetings"))
                .andRespond(withSuccess("<html></html>", MediaType.TEXT_HTML));

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: unreadable response");
    }

    @Test
    void treatsAnEmptyBodyAsAnUnexpectedResponse() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withSuccess());

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: empty response body");
    }

    @Test
    void postsTheBodyAsJson() {
        server.expect(requestTo(BASE_URL + "/greetings"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json(GREETING))
                .andRespond(withStatus(HttpStatus.CREATED));

        client.post(uri -> uri.path("/greetings").build(), new Greeting("hi"));

        server.verify();
    }

    @Test
    void translatesAFailedPostLikeAGet() {
        server.expect(requestTo(BASE_URL + "/greetings")).andRespond(withStatus(HttpStatus.CONFLICT));

        assertThatThrownBy(() -> client.post(uri -> uri.path("/greetings").build(), new Greeting("hi")))
                .isInstanceOf(DownstreamFailureException.class)
                .hasMessage("order-service returned an unexpected response: HTTP 409");
    }

    @Test
    void patchesTheBodyAsJson() {
        server.expect(requestTo(BASE_URL + "/greetings/1"))
                .andExpect(method(HttpMethod.PATCH))
                .andExpect(content().json(GREETING))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        assertThat(client.patch(uri -> uri.path("/greetings/{id}").build(1), new Greeting("hi"))).isTrue();
        server.verify();
    }

    @Test
    void patchesNothingWhenTheServiceAnswersNotFound() {
        server.expect(requestTo(BASE_URL + "/greetings/1")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(client.patch(uri -> uri.path("/greetings/{id}").build(1), new Greeting("hi"))).isFalse();
    }

    @Test
    void translatesARejectedPatchIntoAnInvalidRequest() {
        server.expect(requestTo(BASE_URL + "/greetings/1")).andRespond(withStatus(HttpStatusCode.valueOf(422))
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body("{\"status\":422,\"detail\":\"message is required\"}"));

        assertThatThrownBy(() -> client.patch(uri -> uri.path("/greetings/{id}").build(1), new Greeting("")))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("message is required");
    }

    @Test
    void treatsAnIoErrorAsUnavailableWhenPatchingToo() {
        server.expect(requestTo(BASE_URL + "/greetings/1")).andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> client.patch(uri -> uri.path("/greetings/{id}").build(1), new Greeting("hi")))
                .isInstanceOf(DownstreamUnavailableException.class);
    }

    record Greeting(String message) {
    }

}
