export interface AppConfig {
  port: number;
  logLevel: string;
  serviceName: string;
  otelCollectorUrl: string;
  databaseUrl: string;
  kafkaBrokers: string[];
}

export interface DatabaseCredentials {
  username: string;
  password: string;
}

export interface TelemetryConfig {
  serviceName: string;
  otelCollectorUrl: string;
}

const DEFAULT_PORT = 8084;

export function loadConfig(credentials: DatabaseCredentials, env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? 'info',
    ...loadTelemetryConfig(env),
    databaseUrl: buildDatabaseUrl(credentials, env),
    kafkaBrokers: parseBrokers(env.KAFKA_BROKERS),
  };
}

// Needs no secret: instrumentation.ts runs it via --require, before Vault can be awaited.
export function loadTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  return {
    serviceName: env.OTEL_SERVICE_NAME ?? 'order-service',
    otelCollectorUrl: env.OTEL_COLLECTOR_URL ?? 'http://localhost:4318',
  };
}

function buildDatabaseUrl({ username, password }: DatabaseCredentials, env: NodeJS.ProcessEnv): string {
  const host = env.DB_HOST ?? 'localhost';
  const port = env.DB_PORT ?? '5434';
  const name = env.DB_NAME ?? 'orders';
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parseBrokers(value: string | undefined): string[] {
  return (value ?? 'localhost:9092').split(',').map(broker => broker.trim());
}
