import { loadConfig } from './env';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
  
    expect(loadConfig({})).toEqual({
      port: 8082,
      logLevel: 'info',
      serviceName: 'catalog-service',
      otelCollectorUrl: 'http://localhost:4318',
      databaseUrl: "postgresql://catalog:catalog@localhost:5432/catalog",
      kafkaBrokers: ['localhost:9092'],
      produtoAnalisadoTopic: 'produto.analisado.v1',
      productAnalysisDeadLetterTopic: 'catalog.product-analysis.dlq',
      orderPlacedTopic: 'order.order.placed.v1',
      orderCancelledTopic: 'order.order.cancelled.v1',
      orderStockDeadLetterTopic: 'catalog.order-stock.dlq',
    });
  });

  it('reads values from env', () => {
    const config = loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'catalog',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/catalog',
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
      databaseUrl: 'postgresql://user:password@localhost:5432/catalog',
      kafkaBrokers: ['kafka-1:19092', 'kafka-2:19092'],
      produtoAnalisadoTopic: 'analisado',
      productAnalysisDeadLetterTopic: 'analisado.dlq',
      orderPlacedTopic: 'placed',
      orderCancelledTopic: 'cancelled',
      orderStockDeadLetterTopic: 'order-stock.dlq',
    });
  });

  it.each(['abc', '0', '70000'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
