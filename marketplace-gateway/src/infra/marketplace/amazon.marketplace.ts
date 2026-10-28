import { Logger } from 'pino';
import { z } from 'zod';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import {
    CancelOrderRequest,
    CanonicalOrder,
    ListingDraft,
    MarketplacePort,
    PriceUpdate,
    PublishedListing,
    StockUpdate,
} from '../../core/marketplace/port/out/marketplace.port';
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

// What the marketplace answers to a change it accepted. For a new listing the ASIN is the id of the listing.
const changeAcceptedSchema = z.object({ status: z.literal('ACCEPTED') });
const listingAcceptedSchema = changeAcceptedSchema.extend({ asin: z.string().min(1) });

type AmazonOrder = z.infer<typeof orderSchema>;

export interface AmazonOptions {
    sellerId: string;
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

    // A PUT by SKU: sending the same listing again replaces it instead of creating another.
    async publishListing(draft: ListingDraft): Promise<PublishedListing> {
        const { body } = await this.http.send({
            method: 'PUT',
            path: `/listings/2021-08-01/items/${encodeURIComponent(this.options.sellerId)}/${encodeURIComponent(draft.sku)}`,
            query: { marketplaceIds: this.options.marketplaceId },
            headers: { 'idempotency-key': draft.listingId },
            body: {
                productType: 'PRODUCT',
                attributes: {
                    item_name: [{ value: draft.name }],
                    product_description: [{ value: draft.description }],
                    list_price: [{ currency: 'BRL', value: draft.price }],
                    fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: draft.stock }],
                },
            },
        });

        const accepted = listingAcceptedSchema.safeParse(body);
        if (!accepted.success) {
            throw new MarketplaceRejectedError(`The listing was not accepted: ${z.prettifyError(accepted.error)}`, this.marketplace);
        }

        return { externalListingId: accepted.data.asin };
    }

    // A JSON Patch by SKU: it replaces the availability and leaves the rest of the listing as it is.
    async updateStock({ sku, stock }: StockUpdate): Promise<void> {
        const { body } = await this.http.send({
            method: 'PATCH',
            path: `/listings/2021-08-01/items/${encodeURIComponent(this.options.sellerId)}/${encodeURIComponent(sku)}`,
            query: { marketplaceIds: this.options.marketplaceId },
            body: {
                productType: 'PRODUCT',
                patches: [{
                    op: 'replace',
                    path: '/attributes/fulfillment_availability',
                    value: [{ fulfillment_channel_code: 'DEFAULT', quantity: stock }],
                }],
            },
        });

        const accepted = changeAcceptedSchema.safeParse(body);
        if (!accepted.success) {
            throw new MarketplaceRejectedError(`The stock was not accepted: ${z.prettifyError(accepted.error)}`, this.marketplace);
        }
    }

    // A JSON Patch by SKU: it replaces the price and leaves the rest of the listing as it is.
    async updatePrice({ sku, price }: PriceUpdate): Promise<void> {
        const { body } = await this.http.send({
            method: 'PATCH',
            path: `/listings/2021-08-01/items/${encodeURIComponent(this.options.sellerId)}/${encodeURIComponent(sku)}`,
            query: { marketplaceIds: this.options.marketplaceId },
            body: {
                productType: 'PRODUCT',
                patches: [{
                    op: 'replace',
                    path: '/attributes/list_price',
                    value: [{ currency: 'BRL', value: price }],
                }],
            },
        });

        const accepted = changeAcceptedSchema.safeParse(body);
        if (!accepted.success) {
            throw new MarketplaceRejectedError(`The price was not accepted: ${z.prettifyError(accepted.error)}`, this.marketplace);
        }
    }

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
