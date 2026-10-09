import { loadConfig } from '../../../src/infra/config/env';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 8082,
      logLevel: 'info',
      serviceName: 'catalog-service',
      otelCollectorUrl: 'http://localhost:8000/otel',
    });
  });

  it('reads values from env', () => {
    const config = loadConfig({
      PORT: '9000',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_NAME: 'catalog',
      OTEL_COLLECTOR_URL: 'http://collector:4318',
    });

    expect(config).toEqual({
      port: 9000,
      logLevel: 'debug',
      serviceName: 'catalog',
      otelCollectorUrl: 'http://collector:4318',
    });
  });

  it.each(['abc', '0', '70000'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
