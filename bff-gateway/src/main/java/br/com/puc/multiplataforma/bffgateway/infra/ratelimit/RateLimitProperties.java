package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app.rate-limit")
public record RateLimitProperties(boolean enabled, int requestsPerMinute) {
}
