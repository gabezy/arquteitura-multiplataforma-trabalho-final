package br.com.puc.multiplataforma.bffgateway.infra.shared.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

@ConfigurationProperties(prefix = "downstream")
public record DownstreamProperties(
        @DefaultValue("2s") Duration connectTimeout,
        @DefaultValue("10s") Duration readTimeout
) {
}
