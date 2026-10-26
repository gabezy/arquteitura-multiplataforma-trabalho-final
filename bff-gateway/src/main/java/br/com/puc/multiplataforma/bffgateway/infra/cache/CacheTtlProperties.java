package br.com.puc.multiplataforma.bffgateway.infra.cache;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Map;

@ConfigurationProperties("app.cache")
public record CacheTtlProperties(Map<String, Duration> ttl) {

    public CacheTtlProperties {
        ttl = ttl == null ? Map.of() : Map.copyOf(ttl);
    }

}
