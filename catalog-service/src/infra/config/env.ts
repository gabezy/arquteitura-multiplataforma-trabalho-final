export interface AppConfig {
  port: number;
  logLevel: string;
  serviceName: string;
  otelCollectorUrl: string;
  databaseUrl: string;
}

const DEFAULT_PORT = 8082;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? 'info',
    serviceName: env.OTEL_SERVICE_NAME ?? 'catalog-service',
    otelCollectorUrl: env.OTEL_COLLECTOR_URL ?? 'http://localhost:8000/otel',
    databaseUrl: env.DATABASE_URL ?? 'postgresql://user:password@localhost:5432/catalog',
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
