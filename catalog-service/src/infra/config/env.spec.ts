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
      productEventsTopic: 'catalog.product.events.v1',
      produtoAnalisadoTopic: 'produto.analisado.v1',
      productAnalysisDeadLetterTopic: 'catalog.product-analysis.dlq',
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
      PRODUCT_EVENTS_TOPIC: 'product-events',
      PRODUTO_ANALISADO_TOPIC: 'analisado',
      PRODUCT_ANALYSIS_DLQ_TOPIC: 'analisado.dlq',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'catalog',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://user:password@localhost:5432/catalog',
      kafkaBrokers: ['kafka-1:19092', 'kafka-2:19092'],
      productEventsTopic: 'product-events',
      produtoAnalisadoTopic: 'analisado',
      productAnalysisDeadLetterTopic: 'analisado.dlq',
    });
  });

  it.each(['abc', '0', '70000'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
