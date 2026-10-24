package br.com.puc.multiplataforma.bffgateway.infra.shared.config;

import br.com.puc.multiplataforma.bffgateway.infra.shared.gateway.DownstreamClientFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
@EnableConfigurationProperties(DownstreamProperties.class)
public class DownstreamConfig {

    @Bean
    public DownstreamClientFactory downstreamClientFactory(RestClient.Builder builder, DownstreamProperties properties) {
        return new DownstreamClientFactory(builder, properties.connectTimeout(), properties.readTimeout());
    }

}
