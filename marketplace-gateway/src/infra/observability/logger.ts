import pino, { Logger } from 'pino';

// Trace correlation (trace_id/span_id) and OTLP export are added by
// @opentelemetry/instrumentation-pino when instrumentation.ts is loaded.
export function createLogger(level: string): Logger {
  return pino({ level });
}
