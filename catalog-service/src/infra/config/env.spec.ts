import { loadConfig, loadTelemetryConfig } from './env';

const credentials = { username: 'catalog', password: 'secret' };

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
  
    expect(loadConfig(credentials, {})).toEqual({
      port: 8082,
      logLevel: 'info',
      serviceName: 'catalog-service',
      otelCollectorUrl: 'http://localhost:4318',
      databaseUrl: 'postgresql://catalog:secret@localhost:5432/catalog',
      kafkaBrokers: ['localhost:9092'],
      produtoAnalisadoTopic: 'produto.analisado.v1',
      productAnalysisDeadLetterTopic: 'catalog.product-analysis.dlq',
      orderPlacedTopic: 'order.order.placed.v1',
      orderCancelledTopic: 'order.order.cancelled.v1',
      orderStockDeadLetterTopic: 'catalog.order-stock.dlq',
    });
  });

  it('reads values from env', () => {
    const config = loadConfig(credentials, {
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'catalog',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DB_HOST: 'catalog-db',
      DB_PORT: '6000',
      DB_NAME: 'cat',
      KAFKA_BROKERS: 'kafka-1:19092, kafka-2:19092',
      PRODUTO_ANALISADO_TOPIC: 'analisado',
      PRODUCT_ANALYSIS_DLQ_TOPIC: 'analisado.dlq',
      ORDER_PLACED_TOPIC: 'placed',
      ORDER_CANCELLED_TOPIC: 'cancelled',
      ORDER_STOCK_DLQ_TOPIC: 'order-stock.dlq',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'catalog',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://catalog:secret@catalog-db:6000/cat',
      kafkaBrokers: ['kafka-1:19092', 'kafka-2:19092'],
      produtoAnalisadoTopic: 'analisado',
      productAnalysisDeadLetterTopic: 'analisado.dlq',
      orderPlacedTopic: 'placed',
      orderCancelledTopic: 'cancelled',
      orderStockDeadLetterTopic: 'order-stock.dlq',
    });
  });

  it.each(['abc', '0', '70000'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig(credentials, { PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });

  it('percent-encodes the database credentials', () => {
    const config = loadConfig({ username: 'cat@log', password: 'p@ss/w:rd' }, {});

    expect(config.databaseUrl).toBe('postgresql://cat%40log:p%40ss%2Fw%3Ard@localhost:5432/catalog');
  });
});

describe('loadTelemetryConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadTelemetryConfig({})).toEqual({
      serviceName: 'catalog-service',
      otelCollectorUrl: 'http://localhost:4318',
    });
  });
});
