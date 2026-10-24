package br.com.puc.multiplataforma.bffgateway.infra.shared.gateway;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamFailureException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import br.com.puc.multiplataforma.bffgateway.core.shared.exception.InvalidRequestException;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

public class DownstreamClient {

    private static final ParameterizedTypeReference<Map<String, Object>> PROBLEM_TYPE = new ParameterizedTypeReference<>() {
    };

    private final String service;
    private final RestClient restClient;

    public DownstreamClient(String service, RestClient restClient) {
        this.service = service;
        this.restClient = restClient;
    }

    public <T> T get(Function<UriBuilder, URI> uri, Class<T> responseType) {
        try {
            return fetch(uri, responseType);
        } catch (RestClientException e) {
            throw translate(e);
        }
    }

    public <T> Optional<T> find(Function<UriBuilder, URI> uri, Class<T> responseType) {
        try {
            return Optional.of(fetch(uri, responseType));
        } catch (HttpClientErrorException.NotFound _) {
            return Optional.empty();
        } catch (RestClientException e) {
            throw translate(e);
        }
    }

    private <T> T fetch(Function<UriBuilder, URI> uri, Class<T> responseType) {
        T body = restClient.get().uri(uri).retrieve().body(responseType);
        if (body == null) {
            throw new DownstreamFailureException(service, "empty response body", null);
        }
        return body;
    }

    private RuntimeException translate(RestClientException exception) {
        return switch (exception) {
            case ResourceAccessException _ -> new DownstreamUnavailableException(service, exception);
            case RestClientResponseException response -> translate(response);
            default -> new DownstreamFailureException(service, "unreadable response", exception);
        };
    }

    private RuntimeException translate(RestClientResponseException response) {
        int status = response.getStatusCode().value();
        return switch (status) {
            case 400, 422 -> new InvalidRequestException(problemDetail(response).orElse(service + " rejected the request"));
            case 502, 503, 504 -> new DownstreamUnavailableException(service, response);
            default -> new DownstreamFailureException(service, "HTTP " + status, response);
        };
    }

    private static Optional<String> problemDetail(RestClientResponseException response) {
        try {
            Map<String, Object> problem = response.getResponseBodyAs(PROBLEM_TYPE);
            return Optional.ofNullable(problem)
                    .map(body -> body.get("detail"))
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .filter(detail -> !detail.isBlank());
        } catch (RuntimeException _) {
            return Optional.empty();
        }
    }

}
