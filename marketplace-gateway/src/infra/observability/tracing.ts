import { Attributes, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('marketplace-gateway');

// Runs work that no request started (a poll, a retry loop) inside a span, so its calls and the events
// it records in the outbox show up in one trace. Without the SDK (tests) the span does nothing.
export function withSpan<T>(name: string, attributes: Attributes, work: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(name, { attributes }, async span => {
        try {
            return await work();
        } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        } finally {
            span.end();
        }
    });
}
