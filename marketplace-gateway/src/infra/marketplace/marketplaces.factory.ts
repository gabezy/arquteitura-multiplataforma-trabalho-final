import { Logger } from 'pino';
import { MarketplaceRegistry } from '../../core/marketplace/marketplace.registry';
import { MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import { MarketplacesConfig } from '../config/env';
import { AmazonMarketplace, describeAmazonError } from './amazon.marketplace';
import { MarketplaceHttpClient } from './marketplace-http.client';
import { describeMercadoLivreError, MercadoLivreMarketplace } from './mercado-livre.marketplace';
import { ResilientMarketplace, ResilienceDependencies, ResilienceOptions } from './resilient-marketplace';
import { describeShopeeError, ShopeeMarketplace } from './shopee.marketplace';

// The longest Retry-After the gateway waits for before trying again.
const MAX_RETRY_AFTER_MS = 5000;

export function resilienceOf(config: MarketplacesConfig): ResilienceOptions {
    return {
        maxAttempts: config.maxAttempts,
        baseDelayMs: config.backoffBaseMs,
        maxDelayMs: config.backoffMaxMs,
        maxRetryAfterMs: MAX_RETRY_AFTER_MS,
        breaker: { failureThreshold: config.breakerFailureThreshold, cooldownMs: config.breakerCooldownMs },
    };
}

// One adapter per marketplace, each behind its own retry policy and circuit breaker, so a marketplace
// that is down never opens the circuit of the others.
export function createMarketplaceRegistry(
    config: MarketplacesConfig,
    logger: Logger,
    dependencies: Partial<ResilienceDependencies> = {},
): MarketplaceRegistry {
    const timeoutMs = config.httpTimeoutMs;
    const adapters: MarketplacePort[] = [
        new AmazonMarketplace(
            new MarketplaceHttpClient('AMAZON', { baseUrl: config.amazon.baseUrl, timeoutMs, describeError: describeAmazonError }),
            config.amazon,
            logger,
        ),
        new MercadoLivreMarketplace(
            new MarketplaceHttpClient('MERCADO_LIVRE', { baseUrl: config.mercadoLivre.baseUrl, timeoutMs, describeError: describeMercadoLivreError }),
            config.mercadoLivre,
            logger,
        ),
        new ShopeeMarketplace(
            new MarketplaceHttpClient('SHOPEE', { baseUrl: config.shopee.baseUrl, timeoutMs, describeError: describeShopeeError }),
            config.shopee,
            logger,
        ),
    ];

    return new MarketplaceRegistry(
        adapters.map(adapter => new ResilientMarketplace(adapter, resilienceOf(config), { logger, ...dependencies })),
    );
}
