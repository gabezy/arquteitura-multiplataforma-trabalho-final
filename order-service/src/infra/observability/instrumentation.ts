import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { loadTelemetryConfig } from '../config/env';

// Must be loaded before any other module (node --require) so the
// auto-instrumentations can patch http, express and pino.
const { serviceName, otelCollectorUrl } = loadTelemetryConfig();

const sdk = new NodeSDK({
  serviceName,
  traceExporter: new OTLPTraceExporter({ url: `${otelCollectorUrl}/v1/traces` }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${otelCollectorUrl}/v1/metrics` }),
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ url: `${otelCollectorUrl}/v1/logs` }),
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Only flushes the SDK: main.ts owns the process exit, so the relay round and the
// database pool can finish closing before the process ends.
const shutdown = () => {
  void sdk.shutdown();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
