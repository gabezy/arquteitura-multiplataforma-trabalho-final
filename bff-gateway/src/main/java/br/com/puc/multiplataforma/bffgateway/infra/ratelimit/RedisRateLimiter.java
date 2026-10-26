package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;
import java.time.Duration;

/**
 * Fixed one-minute window per user (ADR-0012): {@code INCR} on {@code rate-limit:<user>:<epoch minute>}, with a
 * 60s expiry set by the first request of the window. When Redis fails the request is allowed (fail-open).
 */
public class RedisRateLimiter implements RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RedisRateLimiter.class);
    private static final long WINDOW_SECONDS = 60;

    private final StringRedisTemplate redis;
    private final int requestsPerMinute;
    private final Clock clock;

    public RedisRateLimiter(StringRedisTemplate redis, int requestsPerMinute, Clock clock) {
        this.redis = redis;
        this.requestsPerMinute = requestsPerMinute;
        this.clock = clock;
    }

    @Override
    public RateLimitDecision tryAcquire(String userId) {
        long now = clock.instant().getEpochSecond();
        String key = "rate-limit:" + userId + ":" + now / WINDOW_SECONDS;
        try {
            Long count = redis.opsForValue().increment(key);
            if (count != null && count == 1) {
                redis.expire(key, Duration.ofSeconds(WINDOW_SECONDS));
            }
            if (count == null || count <= requestsPerMinute) {
                return RateLimitDecision.allow();
            }
            return new RateLimitDecision(false, WINDOW_SECONDS - now % WINDOW_SECONDS);
        } catch (DataAccessException e) {
            log.warn("Rate limit skipped for user {}: Redis is unavailable", userId, e);
            return RateLimitDecision.allow();
        }
    }

}
