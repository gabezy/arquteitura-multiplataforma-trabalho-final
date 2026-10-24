import { Logger } from 'pino';
import { z } from 'zod';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import { CancelOrderRequest, CanonicalOrder, MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import { MarketplaceHttp } from './marketplace-http.client';
import {
    amountOf,
    instantOf,
    MAX_PAGES,
    requireBrl,
    roundMoney,
    translateOrders,
    UntranslatableOrderError,
} from './order-translation';

const UNSHIPPED = 'Unshipped';

const moneySchema = z.object({ CurrencyCode: z.string(), Amount: z.string() });

const orderSchema = z.object({
    AmazonOrderId: z.string().min(1),
    PurchaseDate: z.string(),
    OrderStatus: z.string(),
    OrderTotal: moneySchema,
    OrderItems: z.array(z.object({
        SellerSKU: z.string().min(1),
        QuantityOrdered: z.number().int().positive(),
        ItemPrice: moneySchema,
    })),
});

const pageSchema = z.object({
    payload: z.object({
        Orders: z.array(z.unknown()),
        NextToken: z.string().nullish(),
    }),
});

type AmazonOrder = z.infer<typeof orderSchema>;

export interface AmazonOptions {
    marketplaceId: string;
}

export function describeAmazonError(body: unknown): string | undefined {
    const parsed = z.object({ errors: z.array(z.object({ code: z.string(), message: z.string() })).min(1) }).safeParse(body);

    return parsed.success ? `${parsed.data.errors[0].code}: ${parsed.data.errors[0].message}` : undefined;
}

// Amazon (SP-API style): the order listing carries the items, and ItemPrice is the price of the whole line.
export class AmazonMarketplace implements MarketplacePort {

    readonly marketplace: Marketplace = 'AMAZON';

    constructor(
        private readonly http: MarketplaceHttp,
        private readonly options: AmazonOptions,
        private readonly logger: Logger,
    ) {}

    async fetchNewOrders(since: Date): Promise<CanonicalOrder[]> {
        const orders: CanonicalOrder[] = [];
        let nextToken: string | undefined;

        for (let page = 1; page <= MAX_PAGES; page++) {
            const { body } = await this.http.send({
                method: 'GET',
                path: '/orders/v0/orders',
                // A page after the first is asked for by the token alone.
                query: nextToken === undefined
                    ? { MarketplaceIds: this.options.marketplaceId, CreatedAfter: since.toISOString(), OrderStatuses: UNSHIPPED }
                    : { MarketplaceIds: this.options.marketplaceId, NextToken: nextToken },
            });

            const parsed = pageSchema.safeParse(body);
            if (!parsed.success) {
                throw new MarketplaceRejectedError(`Unexpected order listing: ${z.prettifyError(parsed.error)}`, this.marketplace);
            }

            orders.push(...translateOrders(this.marketplace, parsed.data.payload.Orders, parseOrder, toCanonical, this.logger));

            nextToken = parsed.data.payload.NextToken ?? undefined;
            if (nextToken === undefined) {
                return orders;
            }
        }

        this.logger.warn({ marketplace: this.marketplace, pages: MAX_PAGES }, 'Order listing cut at the maximum of pages');
        return orders;
    }

    async cancelOrder({ externalOrderId, reason }: CancelOrderRequest): Promise<void> {
        await this.http.send({
            method: 'POST',
            path: `/orders/v0/orders/${encodeURIComponent(externalOrderId)}/cancellation`,
            body: { cancelReason: reason ?? 'OTHER' },
        });
    }

}

function parseOrder(raw: unknown): AmazonOrder | undefined {
    const parsed = orderSchema.safeParse(raw);

    if (!parsed.success) {
        throw new UntranslatableOrderError(z.prettifyError(parsed.error));
    }

    return parsed.data.OrderStatus === UNSHIPPED ? parsed.data : undefined;
}

function toCanonical(order: AmazonOrder): CanonicalOrder {
    requireBrl(order.OrderTotal.CurrencyCode);

    return {
        externalOrderId: order.AmazonOrderId,
        items: order.OrderItems.map(item => {
            requireBrl(item.ItemPrice.CurrencyCode);
            // The marketplace informs the price of the line, and the canonical order wants the unit price.
            return {
                sku: item.SellerSKU,
                quantity: item.QuantityOrdered,
                unitPrice: roundMoney(amountOf(item.ItemPrice.Amount, 'ItemPrice.Amount') / item.QuantityOrdered),
            };
        }),
        total: amountOf(order.OrderTotal.Amount, 'OrderTotal.Amount'),
        orderedAt: instantOf(order.PurchaseDate, 'PurchaseDate'),
    };
}
