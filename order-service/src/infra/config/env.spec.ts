import { loadConfig } from './env';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 8084,
      logLevel: 'info',
      serviceName: 'order-service',
      otelCollectorUrl: 'http://localhost:4318',
      databaseUrl: 'postgresql://orders:orders@localhost:5434/orders',
      kafkaBrokers: ['localhost:9092'],
    });
  });

  it('reads values from env', () => {
    const config = loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'order',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DATABASE_URL: 'postgresql://user:password@order-db:5432/orders',
      KAFKA_BROKERS: 'kafka:19092',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'order',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://user:password@order-db:5432/orders',
      kafkaBrokers: ['kafka:19092'],
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
});
