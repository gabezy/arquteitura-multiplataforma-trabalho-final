package br.com.puc.multiplataforma.bffgateway.infra.shared.gateway;

import br.com.puc.multiplataforma.bffgateway.infra.security.AuthenticatedUserHeaderInterceptor;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

public class DownstreamClientFactory {

    private final RestClient.Builder builder;
    private final ClientHttpRequestFactory requestFactory;

    public DownstreamClientFactory(RestClient.Builder builder, Duration connectTimeout, Duration readTimeout) {
        this.builder = builder;
        this.requestFactory = requestFactory(connectTimeout, readTimeout);
    }

    public DownstreamClient create(String service, String baseUrl) {
        RestClient restClient = builder.clone()
                .baseUrl(baseUrl)
                .requestFactory(requestFactory)
                .requestInterceptor(new AuthenticatedUserHeaderInterceptor())
                .build();
        return new DownstreamClient(service, restClient);
    }

    private static ClientHttpRequestFactory requestFactory(Duration connectTimeout, Duration readTimeout) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(connectTimeout)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return requestFactory;
    }

}
