import { Logger } from 'pino';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { CanonicalOrder } from '../../core/marketplace/port/out/marketplace.port';

// The order cannot become a canonical order: the adapter drops it and keeps the others.
export class UntranslatableOrderError extends Error {}

// Pages an adapter reads at most in one poll, so a marketplace that never ends its listing cannot hold the poll.
export const MAX_PAGES = 10;

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function requireBrl(currency: string): void {
    if (currency !== 'BRL') {
        throw new UntranslatableOrderError(`Unsupported currency ${currency}: every amount must be in BRL.`);
    }
}

export function amountOf(text: string, field: string): number {
    const amount = Number(text);

    if (text.trim() === '' || !Number.isFinite(amount)) {
        throw new UntranslatableOrderError(`${field} is not a number: ${text}.`);
    }

    return amount;
}

export function instantOf(value: string | number, field: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new UntranslatableOrderError(`${field} is not a valid date: ${value}.`);
    }

    return date;
}

// Translates each raw order on its own, so one broken order does not take the page down with it.
export function translateOrders<T>(
    marketplace: Marketplace,
    rawOrders: unknown[],
    parse: (raw: unknown) => T | undefined,
    translate: (order: T) => CanonicalOrder,
    logger: Logger,
): CanonicalOrder[] {
    const orders: CanonicalOrder[] = [];

    for (const raw of rawOrders) {
        try {
            const order = parse(raw);
            if (order !== undefined) {
                orders.push(translate(order));
            }
        } catch (err) {
            if (!(err instanceof UntranslatableOrderError)) {
                throw err;
            }
            logger.warn({ marketplace, reason: err.message }, 'Order discarded: it cannot be translated');
        }
    }

    return orders;
}
