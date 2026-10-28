package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;

@Configuration
@EnableConfigurationProperties(RateLimitProperties.class)
@ConditionalOnProperty(name = "app.rate-limit.enabled", havingValue = "true", matchIfMissing = true)
public class RateLimitConfig {

    @Bean
    public RateLimiter rateLimiter(StringRedisTemplate redis, RateLimitProperties properties) {
        return new RedisRateLimiter(redis, properties.requestsPerMinute(), Clock.systemUTC());
    }

}
