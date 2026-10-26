package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

import java.time.Clock;
import java.util.List;

/**
 * Fixed one-minute window per user (ADR-0012): {@code INCR} on {@code rate-limit:<user>:<epoch minute>} plus a 60s
 * expiry, in one Lua script so Redis runs both atomically. Setting the expiry whenever the key has none, not only
 * on the first request, also heals a counter that an older client left without one. When Redis fails the request
 * is allowed (fail-open).
 */
public class RedisRateLimiter implements RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RedisRateLimiter.class);
    private static final long WINDOW_SECONDS = 60;
    private static final RedisScript<Long> INCREMENT_WITH_EXPIRY = RedisScript.of("""
            local count = redis.call('INCR', KEYS[1])
            if redis.call('TTL', KEYS[1]) == -1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return count
            """, Long.class);

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
            Long count = redis.execute(INCREMENT_WITH_EXPIRY, List.of(key), String.valueOf(WINDOW_SECONDS));
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
