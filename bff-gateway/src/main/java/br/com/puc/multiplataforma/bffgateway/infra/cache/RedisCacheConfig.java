package br.com.puc.multiplataforma.bffgateway.infra.cache;

import br.com.puc.multiplataforma.bffgateway.core.billing.domain.Invoice;
import br.com.puc.multiplataforma.bffgateway.core.marketplace.domain.Listing;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.Order;
import br.com.puc.multiplataforma.bffgateway.core.order.domain.SalesByMarketplaceReport;
import br.com.puc.multiplataforma.bffgateway.core.shared.domain.Page;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.interceptor.LoggingCacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheWriter;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.JacksonJsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;
import tools.jackson.databind.JavaType;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.type.TypeFactory;

import java.time.Duration;
import java.util.Map;

/**
 * Caches the reads the BFF forwards to the other services in Redis (ADR-0012). Each cache has its own TTL
 * ({@code app.cache.ttl.<cache>}) and a serializer bound to the type it holds, so a cached page comes back with
 * its items typed. Writes are immediate: by default Lettuce clears a cache asynchronously, and a read right after
 * a price change could still get the old listings. A Redis failure is logged and the call goes to the service
 * (fail-open).
 */
@Configuration(proxyBeanMethods = false)
@EnableCaching
@EnableConfigurationProperties(CacheTtlProperties.class)
public class RedisCacheConfig implements CachingConfigurer {

    @Bean
    public RedisCacheManagerBuilderCustomizer perCacheTtlAndType(RedisConnectionFactory connectionFactory,
                                                                 CacheTtlProperties properties, JsonMapper jsonMapper) {
        Map<String, JavaType> types = cachedTypes(jsonMapper.getTypeFactory());
        return builder -> {
            builder.cacheWriter(RedisCacheWriter.create(connectionFactory, RedisCacheWriter.RedisCacheWriterConfigurer::immediateWrites));
            types.forEach((cache, type) -> builder.withCacheConfiguration(cache,
                    RedisCacheConfiguration.defaultCacheConfig()
                            .entryTtl(ttlOf(properties, cache))
                            .disableCachingNullValues()
                            .serializeValuesWith(SerializationPair.fromSerializer(new JacksonJsonRedisSerializer<>(jsonMapper, type)))));
        };
    }

    @Override
    public CacheErrorHandler errorHandler() {
        return new LoggingCacheErrorHandler();
    }

    private static Map<String, JavaType> cachedTypes(TypeFactory types) {
        return Map.of(
                CacheNames.LISTINGS, types.constructParametricType(Page.class, Listing.class),
                CacheNames.LISTING, types.constructType(Listing.class),
                CacheNames.ORDERS, types.constructParametricType(Page.class, Order.class),
                CacheNames.ORDER, types.constructType(Order.class),
                CacheNames.SALES_BY_MARKETPLACE, types.constructType(SalesByMarketplaceReport.class),
                CacheNames.INVOICES, types.constructParametricType(Page.class, Invoice.class),
                CacheNames.INVOICE, types.constructType(Invoice.class)
        );
    }

    private static Duration ttlOf(CacheTtlProperties properties, String cache) {
        Duration ttl = properties.ttl().get(cache);
        if (ttl == null) {
            throw new IllegalStateException("app.cache.ttl." + cache + " is not set");
        }
        return ttl;
    }

}
