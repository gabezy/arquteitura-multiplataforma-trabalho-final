import { loadConfig } from './env';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
  
    expect(loadConfig({})).toEqual({
      port: 8082,
      logLevel: 'info',
      serviceName: 'catalog-service',
      otelCollectorUrl: 'http://localhost:8000/otel',
      databaseUrl: "postgresql://catalog:catalog@localhost:5432/catalog",
    });
  });

  it('reads values from env', () => {
    const config = loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'catalog',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/catalog',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'catalog',
      otelCollectorUrl: 'http://collector:4318',
      databaseUrl: 'postgresql://user:password@localhost:5432/catalog',
    });
  });

  it.each(['abc', '0', '70000'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
