import { loadConfig, loadTelemetryConfig } from './env';

const credentials = { username: 'orders', password: 'secret' };

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadConfig(credentials, {})).toEqual({
      port: 8084,
      logLevel: 'info',
      serviceName: 'order-service',
      otelCollectorUrl: 'http://localhost:4318',
      databaseUrl: 'postgresql://orders:secret@localhost:5434/orders',
      kafkaBrokers: ['localhost:9092'],
    });
  });

  it('reads values from env', () => {
    const config = loadConfig(credentials, {
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'order',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DB_HOST: 'order-db',
      DB_PORT: '5432',
      DB_NAME: 'ord',
      KAFKA_BROKERS: 'kafka:19092',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'order',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://orders:secret@order-db:5432/ord',
      kafkaBrokers: ['kafka:19092'],
    });
  });

  it('percent-encodes the database credentials', () => {
    const config = loadConfig({ username: 'or@ders', password: 'p@ss/w:rd' }, {});

    expect(config.databaseUrl).toBe('postgresql://or%40ders:p%40ss%2Fw%3Ard@localhost:5434/orders');
  });

  it('splits KAFKA_BROKERS on commas and trims each broker', () => {
    expect(loadConfig(credentials, { KAFKA_BROKERS: 'kafka-1:19092, kafka-2:19092' }).kafkaBrokers).toEqual([
      'kafka-1:19092',
      'kafka-2:19092',
    ]);
  });

  it.each(['1', '65535'])('accepts PORT %s', port => {
    expect(loadConfig(credentials, { PORT: port }).port).toBe(Number(port));
  });

  it.each(['abc', '0', '65536', '80.5'])('rejects PORT %s', port => {
    expect(() => loadConfig(credentials, { PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});

describe('loadTelemetryConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadTelemetryConfig({})).toEqual({
      serviceName: 'order-service',
      otelCollectorUrl: 'http://localhost:4318',
    });
  });
});
