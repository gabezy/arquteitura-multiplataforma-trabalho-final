import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';

// W3C trace context (traceparent, tracestate, baggage) in a serializable form, so work
// that runs later, outside the request (e.g. the outbox relay), joins the same trace.
export type TraceHeaders = Record<string, string>;

export const currentTraceHeaders = (): TraceHeaders => {
  const headers: TraceHeaders = {};
  propagation.inject(context.active(), headers);
  return headers;
};

export const withTraceHeaders = <T>(headers: TraceHeaders | null | undefined, fn: () => T): T =>
  context.with(propagation.extract(ROOT_CONTEXT, headers ?? {}), fn);
