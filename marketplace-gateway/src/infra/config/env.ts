export interface MarketplacesConfig {
  amazon: { baseUrl: string; sellerId: string; marketplaceId: string };
  mercadoLivre: { baseUrl: string; sellerId: string };
  shopee: { baseUrl: string; shopId: string };
  httpTimeoutMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  breakerFailureThreshold: number;
  breakerCooldownMs: number;
}

export interface CatalogConfig {
  serviceUrl: string;
  timeoutMs: number;
}

export interface OrderPollingConfig {
  intervalMs: number;
  overlapMs: number;
  initialLookbackMs: number;
}

export interface StockSyncConfig {
  intervalMs: number;
  batchSize: number;
}

export interface AppConfig {
  port: number;
  logLevel: string;
  serviceName: string;
  otelCollectorUrl: string;
  databaseUrl: string;
  kafkaBrokers: string[];
  marketplaces: MarketplacesConfig;
  catalog: CatalogConfig;
  orderPolling: OrderPollingConfig;
  stockSync: StockSyncConfig;
  catalogProductApprovedTopic: string;
  catalogStockChangedTopic: string;
  catalogProductDeadLetterTopic: string;
  orderCancelledTopic: string;
  orderCancelledDeadLetterTopic: string;
}

const DEFAULT_PORT = 8087;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? 'info',
    serviceName: env.OTEL_SERVICE_NAME ?? 'marketplace-gateway',
    otelCollectorUrl: env.OTEL_COLLECTOR_URL ?? 'http://localhost:4318',
    databaseUrl: env.DATABASE_URL ?? 'postgresql://marketplace:marketplace@localhost:5436/marketplace',
    kafkaBrokers: parseBrokers(env.KAFKA_BROKERS),
    marketplaces: {
      amazon: {
        baseUrl: parseUrl(env, 'AMAZON_BASE_URL', 'http://localhost:8089/amazon'),
        sellerId: env.AMAZON_SELLER_ID ?? 'A1B2C3D4E5',
        marketplaceId: env.AMAZON_MARKETPLACE_ID ?? 'A2Q3Y263D00KWC',
      },
      mercadoLivre: {
        baseUrl: parseUrl(env, 'MERCADO_LIVRE_BASE_URL', 'http://localhost:8089/mercadolivre'),
        sellerId: env.MERCADO_LIVRE_SELLER_ID ?? '2000',
      },
      shopee: {
        baseUrl: parseUrl(env, 'SHOPEE_BASE_URL', 'http://localhost:8089/shopee'),
        shopId: env.SHOPEE_SHOP_ID ?? '1001',
      },
      httpTimeoutMs: parsePositiveInt(env, 'MARKETPLACE_TIMEOUT_MS', 3000),
      maxAttempts: parsePositiveInt(env, 'MARKETPLACE_MAX_ATTEMPTS', 3),
      backoffBaseMs: parsePositiveInt(env, 'MARKETPLACE_BACKOFF_BASE_MS', 200),
      backoffMaxMs: parsePositiveInt(env, 'MARKETPLACE_BACKOFF_MAX_MS', 2000),
      breakerFailureThreshold: parsePositiveInt(env, 'MARKETPLACE_BREAKER_FAILURES', 5),
      breakerCooldownMs: parsePositiveInt(env, 'MARKETPLACE_BREAKER_COOLDOWN_MS', 30_000),
    },
    catalog: {
      serviceUrl: parseUrl(env, 'CATALOG_SERVICE_URL', 'http://localhost:8082'),
      timeoutMs: parsePositiveInt(env, 'CATALOG_TIMEOUT_MS', 3000),
    },
    orderPolling: {
      intervalMs: parsePositiveInt(env, 'ORDER_POLL_INTERVAL_MS', 5000),
      overlapMs: parsePositiveInt(env, 'ORDER_POLL_OVERLAP_MS', 60_000),
      initialLookbackMs: parsePositiveInt(env, 'ORDER_POLL_LOOKBACK_MS', 86_400_000),
    },
    stockSync: {
      intervalMs: parsePositiveInt(env, 'STOCK_SYNC_INTERVAL_MS', 2000),
      batchSize: parsePositiveInt(env, 'STOCK_SYNC_BATCH_SIZE', 50),
    },
    catalogProductApprovedTopic: env.CATALOG_PRODUCT_APPROVED_TOPIC ?? 'catalog.product.approved.v1',
    catalogStockChangedTopic: env.CATALOG_STOCK_CHANGED_TOPIC ?? 'catalog.product.stock-changed.v1',
    catalogProductDeadLetterTopic: env.CATALOG_PRODUCT_DLQ_TOPIC ?? 'marketplace.catalog-product.dlq',
    orderCancelledTopic: env.ORDER_CANCELLED_TOPIC ?? 'order.order.cancelled.v1',
    orderCancelledDeadLetterTopic: env.ORDER_CANCELLED_DLQ_TOPIC ?? 'marketplace.order-cancelled.dlq',
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function parseUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name] ?? fallback;
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return value;
}

function parseBrokers(value: string | undefined): string[] {
  return (value ?? 'localhost:9092').split(',').map(broker => broker.trim());
}
