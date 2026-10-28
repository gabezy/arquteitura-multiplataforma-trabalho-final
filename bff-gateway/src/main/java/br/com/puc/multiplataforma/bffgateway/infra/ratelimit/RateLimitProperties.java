package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * A missing or zero limit would answer 429 to every authenticated request, so startup fails instead.
 */
@Validated
@ConfigurationProperties("app.rate-limit")
public record RateLimitProperties(boolean enabled, @Positive int requestsPerMinute) {
}
