import { IHeaders } from 'kafkajs';
import { z } from 'zod';
import { TraceHeaders } from '../observability/trace-context';
import { headerValue } from './dead-letter';

export const EVENT_ID = /^[\x20-\x7E]{1,200}$/;

// CloudEvents binary mode, as every outbox relay of the system publishes it. Returns why the headers
// are out of contract, or undefined when they are fine. ce_subject is only required here; each
// consumer checks that it names the aggregate of the payload.
export function cloudEventHeaderError(
    headers: IHeaders | undefined,
    eventId: string | undefined,
    { source, type }: { source: string; type: string },
): string | undefined {
    if (!eventId || !EVENT_ID.test(eventId)) return 'ce_id must be 1 to 200 printable ASCII characters.';
    if (headerValue(headers, 'ce_specversion') !== '1.0') return 'ce_specversion must be 1.0.';
    if (headerValue(headers, 'ce_source') !== source) return `ce_source must be ${source}.`;
    if (headerValue(headers, 'ce_type') !== type) return `ce_type must be ${type}.`;
    if (!headerValue(headers, 'ce_subject')) return 'ce_subject is required.';
    const eventTime = headerValue(headers, 'ce_time');
    if (!eventTime || !z.iso.datetime({ offset: true }).safeParse(eventTime).success) return 'ce_time must be an ISO-8601 timestamp.';
    if (headerValue(headers, 'content-type') !== 'application/json') return 'content-type must be application/json.';
    return undefined;
}

export function traceHeadersOf(headers: IHeaders | undefined): TraceHeaders {
    const traceHeaders: TraceHeaders = {};
    for (const name of ['traceparent', 'tracestate', 'baggage']) {
        const value = headerValue(headers, name);
        if (value !== undefined) traceHeaders[name] = value;
    }
    return traceHeaders;
}

// SQLSTATE class 22 (data exception): the database refuses the values themselves, so a redelivery
// fails the same way. Connection and lock errors keep being retried.
export function isDataException(err: unknown): err is Error {
    const code = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
    return typeof code === 'string' && code.startsWith('22');
}
