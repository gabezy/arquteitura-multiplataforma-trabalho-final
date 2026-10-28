package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.ServerSocket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class RedisRateLimiterTest {

    private static final int LIMIT = 3;
    private static final Instant NOW = Instant.parse("2026-10-26T10:00:15Z");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2-alpine").withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;

    @BeforeAll
    static void connect() {
        connectionFactory = connectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        redis = new StringRedisTemplate(connectionFactory);
    }

    @AfterAll
    static void disconnect() {
        connectionFactory.destroy();
    }

    @BeforeEach
    void startClean() {
        redis.execute(connection -> {
            connection.serverCommands().flushAll();
            return null;
        }, true);
    }

    @Test
    void allowsUpToTheLimitInTheSameMinute() {
        RedisRateLimiter limiter = limiterAt(NOW);

        for (int i = 0; i < LIMIT; i++) {
            assertThat(limiter.tryAcquire("user-a").allowed()).isTrue();
        }
        RateLimitDecision denied = limiter.tryAcquire("user-a");

        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfterSeconds()).isEqualTo(45);
    }

    @Test
    void countsEachUserSeparately() {
        RedisRateLimiter limiter = limiterAt(NOW);

        for (int i = 0; i <= LIMIT; i++) {
            limiter.tryAcquire("user-a");
        }

        assertThat(limiter.tryAcquire("user-b").allowed()).isTrue();
    }

    @Test
    void startsOverInTheNextMinute() {
        RedisRateLimiter limiter = limiterAt(NOW);
        for (int i = 0; i <= LIMIT; i++) {
            limiter.tryAcquire("user-a");
        }

        assertThat(limiterAt(NOW.plusSeconds(60)).tryAcquire("user-a").allowed()).isTrue();
    }

    @Test
    void expiresTheCounter() {
        limiterAt(NOW).tryAcquire("user-a");

        String key = redis.keys("rate-limit:user-a:*").iterator().next();
        assertThat(redis.getExpire(key, TimeUnit.SECONDS)).isBetween(1L, 60L);
    }

    @Test
    void setsTheExpiryOfACounterLeftWithoutOne() {
        String key = "rate-limit:user-a:" + NOW.getEpochSecond() / 60;
        redis.opsForValue().set(key, "1");

        limiterAt(NOW).tryAcquire("user-a");

        assertThat(redis.opsForValue().get(key)).isEqualTo("2");
        assertThat(redis.getExpire(key, TimeUnit.SECONDS)).isBetween(1L, 60L);
    }

    @Test
    void allowsWhenRedisIsDown() {
        LettuceConnectionFactory unreachable = connectionFactory("127.0.0.1", freePort());
        try {
            RedisRateLimiter limiter = new RedisRateLimiter(new StringRedisTemplate(unreachable), LIMIT, fixedClock(NOW));

            assertThat(limiter.tryAcquire("user-a").allowed()).isTrue();
        } finally {
            unreachable.destroy();
        }
    }

    private static RedisRateLimiter limiterAt(Instant instant) {
        return new RedisRateLimiter(redis, LIMIT, fixedClock(instant));
    }

    private static Clock fixedClock(Instant instant) {
        return Clock.fixed(instant, ZoneOffset.UTC);
    }

    private static LettuceConnectionFactory connectionFactory(String host, int port) {
        LettuceClientConfiguration client = LettuceClientConfiguration.builder().commandTimeout(Duration.ofMillis(500)).build();
        LettuceConnectionFactory factory = new LettuceConnectionFactory(new RedisStandaloneConfiguration(host, port), client);
        factory.afterPropertiesSet();
        factory.start();
        return factory;
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

}
