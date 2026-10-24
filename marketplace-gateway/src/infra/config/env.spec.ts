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
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'gateway',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://user:password@marketplace-db:5432/marketplace',
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
