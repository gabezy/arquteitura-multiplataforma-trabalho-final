import { Logger } from 'pino';
import { z } from 'zod';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import {
    MarketplaceRejectedError,
    MarketplaceUnavailableError,
} from '../../core/marketplace/model/marketplace.errors';
import {
    CancelOrderRequest,
    CanonicalOrder,
    ListingDraft,
    MarketplacePort,
    PublishedListing,
} from '../../core/marketplace/port/out/marketplace.port';
import { MarketplaceHttp } from './marketplace-http.client';
import { instantOf, MAX_PAGES, translateOrders, UntranslatableOrderError } from './order-translation';

const READY_TO_SHIP = 'READY_TO_SHIP';
const PAGE_SIZE = 100;
// The catalog has no category, so every listing goes in this one.
const DEFAULT_CATEGORY_ID = 100001;
// Shopee refuses an order listing that spans more than 15 days.
const MAX_WINDOW_SECONDS = 15 * 24 * 60 * 60;
// Errors inside a 200 that say the marketplace is busy, not that the call is wrong.
const TRANSIENT_ERRORS = new Set(['error_server', 'error_busy', 'error_rate_limit', 'error_timeout']);

const envelopeSchema = z.object({
    error: z.string(),
    message: z.string().optional(),
    response: z.unknown().optional(),
});

const orderSchema = z.object({
    order_sn: z.string().min(1),
    order_status: z.string(),
    create_time: z.number(),
    total_amount: z.number(),
    item_list: z.array(z.object({
        item_sku: z.string().min(1),
        model_quantity_purchased: z.number().int().positive(),
        model_discounted_price: z.number(),
    })),
});

const itemCreatedSchema = z.object({ item_id: z.number() });

const orderListSchema = z.object({
    more: z.boolean(),
    next_cursor: z.string().optional(),
    order_list: z.array(z.unknown()),
});

type ShopeeOrder = z.infer<typeof orderSchema>;

export interface ShopeeOptions {
    shopId: string;
}

export function describeShopeeError(body: unknown): string | undefined {
    const parsed = envelopeSchema.safeParse(body);

    return parsed.success && parsed.data.error !== '' ? reasonOf(parsed.data.error, parsed.data.message) : undefined;
}

function reasonOf(error: string, message: string | undefined): string {
    return message ? `${error}: ${message}` : error;
}

// Shopee: RPC style, so the errors come inside a 200, the order listing carries the items with their
// unit price, and the dates are epoch seconds.
export class ShopeeMarketplace implements MarketplacePort {

    readonly marketplace: Marketplace = 'SHOPEE';

    constructor(
        private readonly http: MarketplaceHttp,
        private readonly options: ShopeeOptions,
        private readonly logger: Logger,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async publishListing(draft: ListingDraft): Promise<PublishedListing> {
        const { body } = await this.http.send({
            method: 'POST',
            path: '/api/v2/product/add_item',
            query: { shop_id: this.options.shopId },
            headers: { 'idempotency-key': draft.listingId },
            body: {
                item_name: draft.name,
                description: draft.description,
                original_price: draft.price,
                normal_stock: draft.stock,
                item_sku: draft.sku,
                category_id: DEFAULT_CATEGORY_ID,
            },
        });

        // The error of a refusal comes inside the 200: responseOf turns it into the exception.
        const created = itemCreatedSchema.safeParse(this.responseOf(body));
        if (!created.success) {
            throw new MarketplaceRejectedError(`The listing was not created: ${z.prettifyError(created.error)}`, this.marketplace);
        }

        return { externalListingId: String(created.data.item_id) };
    }

    async fetchNewOrders(since: Date): Promise<CanonicalOrder[]> {
        const timeTo = Math.floor(this.now().getTime() / 1000);
        const timeFrom = Math.max(Math.floor(since.getTime() / 1000), timeTo - MAX_WINDOW_SECONDS);
        const orders: CanonicalOrder[] = [];
        let cursor: string | undefined;

        for (let page = 1; page <= MAX_PAGES; page++) {
            const { body } = await this.http.send({
                method: 'GET',
                path: '/api/v2/order/get_order_list',
                query: {
                    shop_id: this.options.shopId,
                    time_range_field: 'create_time',
                    time_from: timeFrom,
                    time_to: timeTo,
                    page_size: PAGE_SIZE,
                    order_status: READY_TO_SHIP,
                    cursor,
                },
            });

            const list = orderListSchema.safeParse(this.responseOf(body));
            if (!list.success) {
                throw new MarketplaceRejectedError(`Unexpected order list: ${z.prettifyError(list.error)}`, this.marketplace);
            }

            orders.push(...translateOrders(this.marketplace, list.data.order_list, parseOrder, toCanonical, this.logger));

            cursor = list.data.next_cursor || undefined;
            if (!list.data.more || cursor === undefined) {
                return orders;
            }
        }

        this.logger.warn({ marketplace: this.marketplace, pages: MAX_PAGES }, 'Order list cut at the maximum of pages');
        return orders;
    }

    async cancelOrder({ externalOrderId, reason }: CancelOrderRequest): Promise<void> {
        const { body } = await this.http.send({
            method: 'POST',
            path: '/api/v2/order/cancel_order',
            query: { shop_id: this.options.shopId },
            body: { order_sn: externalOrderId, cancel_reason: reason ?? 'OTHER' },
        });

        this.responseOf(body);
    }

    // The answer of every call: an envelope with the error, if any, and the response.
    private responseOf(body: unknown): unknown {
        const envelope = envelopeSchema.safeParse(body);

        if (!envelope.success) {
            throw new MarketplaceRejectedError(`Unexpected answer: ${z.prettifyError(envelope.error)}`, this.marketplace);
        }

        const { error, message, response } = envelope.data;
        if (error === '') {
            return response;
        }

        const reason = reasonOf(error, message);
        throw TRANSIENT_ERRORS.has(error)
            ? new MarketplaceUnavailableError(reason, this.marketplace)
            : new MarketplaceRejectedError(reason, this.marketplace);
    }

}

function parseOrder(raw: unknown): ShopeeOrder | undefined {
    const parsed = orderSchema.safeParse(raw);

    if (!parsed.success) {
        throw new UntranslatableOrderError(z.prettifyError(parsed.error));
    }

    return parsed.data.order_status === READY_TO_SHIP ? parsed.data : undefined;
}

function toCanonical(order: ShopeeOrder): CanonicalOrder {
    return {
        externalOrderId: order.order_sn,
        items: order.item_list.map(item => ({
            sku: item.item_sku,
            quantity: item.model_quantity_purchased,
            unitPrice: item.model_discounted_price,
        })),
        total: order.total_amount,
        orderedAt: instantOf(order.create_time * 1000, 'create_time'),
    };
}
