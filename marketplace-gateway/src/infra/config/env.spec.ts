import { loadConfig } from './env';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 8087,
      logLevel: 'info',
      serviceName: 'marketplace-gateway',
      otelCollectorUrl: 'http://localhost:4318',
      databaseUrl: 'postgresql://marketplace:marketplace@localhost:5436/marketplace',
      kafkaBrokers: ['localhost:9092'],
      marketplaces: {
        amazon: { baseUrl: 'http://localhost:8089/amazon', sellerId: 'A1B2C3D4E5', marketplaceId: 'A2Q3Y263D00KWC' },
        mercadoLivre: { baseUrl: 'http://localhost:8089/mercadolivre', sellerId: '2000' },
        shopee: { baseUrl: 'http://localhost:8089/shopee', shopId: '1001' },
        httpTimeoutMs: 3000,
        maxAttempts: 3,
        backoffBaseMs: 200,
        backoffMaxMs: 2000,
        breakerFailureThreshold: 5,
        breakerCooldownMs: 30_000,
      },
      catalog: { serviceUrl: 'http://localhost:8082', timeoutMs: 3000 },
      orderPolling: { intervalMs: 5000, overlapMs: 60_000, initialLookbackMs: 86_400_000 },
      stockSync: { intervalMs: 2000, batchSize: 50 },
      catalogProductApprovedTopic: 'catalog.product.approved.v1',
      catalogStockChangedTopic: 'catalog.product.stock-changed.v1',
      catalogProductDeadLetterTopic: 'marketplace.catalog-product.dlq',
      orderCancelledTopic: 'order.order.cancelled.v1',
      orderCancelledDeadLetterTopic: 'marketplace.order-cancelled.dlq',
    });
  });

  it('reads values from env', () => {
    const config = loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'gateway',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DATABASE_URL: 'postgresql://user:password@marketplace-db:5432/marketplace',
      KAFKA_BROKERS: 'kafka:19092',
      AMAZON_BASE_URL: 'http://wiremock:8080/amazon',
      AMAZON_SELLER_ID: 'ASELLER',
      AMAZON_MARKETPLACE_ID: 'ATVPDKIKX0DER',
      MERCADO_LIVRE_BASE_URL: 'http://wiremock:8080/mercadolivre',
      MERCADO_LIVRE_SELLER_ID: '3000',
      SHOPEE_BASE_URL: 'http://wiremock:8080/shopee',
      SHOPEE_SHOP_ID: '2002',
      MARKETPLACE_TIMEOUT_MS: '1500',
      MARKETPLACE_MAX_ATTEMPTS: '4',
      MARKETPLACE_BACKOFF_BASE_MS: '100',
      MARKETPLACE_BACKOFF_MAX_MS: '800',
      MARKETPLACE_BREAKER_FAILURES: '2',
      MARKETPLACE_BREAKER_COOLDOWN_MS: '10000',
      CATALOG_SERVICE_URL: 'http://catalog-service:8082',
      CATALOG_TIMEOUT_MS: '1200',
      ORDER_POLL_INTERVAL_MS: '1000',
      ORDER_POLL_OVERLAP_MS: '5000',
      ORDER_POLL_LOOKBACK_MS: '3600000',
      STOCK_SYNC_INTERVAL_MS: '500',
      STOCK_SYNC_BATCH_SIZE: '10',
      CATALOG_PRODUCT_APPROVED_TOPIC: 'approved',
      CATALOG_STOCK_CHANGED_TOPIC: 'stock-changed',
      CATALOG_PRODUCT_DLQ_TOPIC: 'approved.dlq',
      ORDER_CANCELLED_TOPIC: 'cancelled',
      ORDER_CANCELLED_DLQ_TOPIC: 'cancelled.dlq',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'gateway',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://user:password@marketplace-db:5432/marketplace',
      kafkaBrokers: ['kafka:19092'],
      marketplaces: {
        amazon: { baseUrl: 'http://wiremock:8080/amazon', sellerId: 'ASELLER', marketplaceId: 'ATVPDKIKX0DER' },
        mercadoLivre: { baseUrl: 'http://wiremock:8080/mercadolivre', sellerId: '3000' },
        shopee: { baseUrl: 'http://wiremock:8080/shopee', shopId: '2002' },
        httpTimeoutMs: 1500,
        maxAttempts: 4,
        backoffBaseMs: 100,
        backoffMaxMs: 800,
        breakerFailureThreshold: 2,
        breakerCooldownMs: 10_000,
      },
      catalog: { serviceUrl: 'http://catalog-service:8082', timeoutMs: 1200 },
      orderPolling: { intervalMs: 1000, overlapMs: 5000, initialLookbackMs: 3_600_000 },
      stockSync: { intervalMs: 500, batchSize: 10 },
      catalogProductApprovedTopic: 'approved',
      catalogStockChangedTopic: 'stock-changed',
      catalogProductDeadLetterTopic: 'approved.dlq',
      orderCancelledTopic: 'cancelled',
      orderCancelledDeadLetterTopic: 'cancelled.dlq',
    });
  });

  it('splits KAFKA_BROKERS on commas and trims each broker', () => {
    expect(loadConfig({ KAFKA_BROKERS: 'kafka-1:19092, kafka-2:19092' }).kafkaBrokers).toEqual([
      'kafka-1:19092',
      'kafka-2:19092',
    ]);
  });

  it.each(['1', '65535'])('accepts PORT %s', port => {
    expect(loadConfig({ PORT: port }).port).toBe(Number(port));
  });

  it.each(['abc', '0', '65536', '80.5'])('rejects PORT %s', port => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });

  describe.each([
    'MARKETPLACE_TIMEOUT_MS',
    'MARKETPLACE_MAX_ATTEMPTS',
    'MARKETPLACE_BACKOFF_BASE_MS',
    'MARKETPLACE_BACKOFF_MAX_MS',
    'MARKETPLACE_BREAKER_FAILURES',
    'MARKETPLACE_BREAKER_COOLDOWN_MS',
    'CATALOG_TIMEOUT_MS',
    'ORDER_POLL_INTERVAL_MS',
    'ORDER_POLL_OVERLAP_MS',
    'ORDER_POLL_LOOKBACK_MS',
    'STOCK_SYNC_INTERVAL_MS',
    'STOCK_SYNC_BATCH_SIZE',
  ])('%s', name => {
    it.each(['abc', '0', '-5', '1.5', ''])('rejects %p', value => {
      expect(() => loadConfig({ [name]: value })).toThrow(`Invalid ${name}: ${value}`);
    });

    it('accepts a positive integer', () => {
      expect(() => loadConfig({ [name]: '1' })).not.toThrow();
    });
  });

  it.each(['AMAZON_BASE_URL', 'MERCADO_LIVRE_BASE_URL', 'SHOPEE_BASE_URL', 'CATALOG_SERVICE_URL'])('rejects a %s that is not a URL', name => {
    expect(() => loadConfig({ [name]: 'wiremock/amazon' })).toThrow(`Invalid ${name}: wiremock/amazon`);
  });
});
