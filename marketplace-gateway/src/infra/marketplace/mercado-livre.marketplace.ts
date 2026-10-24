import { Logger } from 'pino';
import { z } from 'zod';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import {
    CancelOrderRequest,
    CanonicalOrder,
    ListingDraft,
    MarketplacePort,
    PublishedListing,
    StockUpdate,
} from '../../core/marketplace/port/out/marketplace.port';
import { MarketplaceHttp } from './marketplace-http.client';
import { instantOf, MAX_PAGES, requireBrl, translateOrders, UntranslatableOrderError } from './order-translation';

const PAID = 'paid';
const PAGE_SIZE = 50;
// The title of a listing has at most 60 characters. The catalog has no category, so every listing goes in this one.
const MAX_TITLE_LENGTH = 60;
const DEFAULT_CATEGORY_ID = 'MLB1648';

const listingCreatedSchema = z.object({ id: z.string().min(1) });

const orderSchema = z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    date_created: z.string(),
    total_amount: z.number(),
    currency_id: z.string(),
    order_items: z.array(z.object({
        item: z.object({ seller_custom_field: z.string().min(1) }),
        quantity: z.number().int().positive(),
        unit_price: z.number(),
    })),
});

const pageSchema = z.object({
    results: z.array(z.unknown()),
    paging: z.object({ total: z.number() }),
});

type MercadoLivreOrder = z.infer<typeof orderSchema>;

export interface MercadoLivreOptions {
    sellerId: string;
}

export function describeMercadoLivreError(body: unknown): string | undefined {
    const parsed = z.object({ message: z.string(), cause: z.array(z.object({ message: z.string() })).optional() }).safeParse(body);

    if (!parsed.success) {
        return undefined;
    }

    const cause = parsed.data.cause?.[0]?.message;
    return cause ? `${parsed.data.message}: ${cause}` : parsed.data.message;
}

// Mercado Livre: the order search carries the items with their unit price, pages by offset and limit,
// and the order id is a number.
export class MercadoLivreMarketplace implements MarketplacePort {

    readonly marketplace: Marketplace = 'MERCADO_LIVRE';

    constructor(
        private readonly http: MarketplaceHttp,
        private readonly options: MercadoLivreOptions,
        private readonly logger: Logger,
    ) {}

    async publishListing(draft: ListingDraft): Promise<PublishedListing> {
        const { body } = await this.http.send({
            method: 'POST',
            path: '/items',
            headers: { 'idempotency-key': draft.listingId },
            body: {
                title: draft.name.slice(0, MAX_TITLE_LENGTH),
                category_id: DEFAULT_CATEGORY_ID,
                price: draft.price,
                currency_id: 'BRL',
                available_quantity: draft.stock,
                buying_mode: 'buy_it_now',
                listing_type_id: 'gold_special',
                condition: 'new',
                description: { plain_text: draft.description },
                seller_custom_field: draft.sku,
            },
        });

        const created = listingCreatedSchema.safeParse(body);
        if (!created.success) {
            throw new MarketplaceRejectedError(`The listing was not created: ${z.prettifyError(created.error)}`, this.marketplace);
        }

        return { externalListingId: created.data.id };
    }

    async updateStock({ externalListingId, stock }: StockUpdate): Promise<void> {
        await this.http.send({
            method: 'PUT',
            path: `/items/${encodeURIComponent(externalListingId)}`,
            body: { available_quantity: stock },
        });
    }

    async fetchNewOrders(since: Date): Promise<CanonicalOrder[]> {
        const orders: CanonicalOrder[] = [];
        let offset = 0;

        for (let page = 1; page <= MAX_PAGES; page++) {
            const { body } = await this.http.send({
                method: 'GET',
                path: '/orders/search',
                query: {
                    seller: this.options.sellerId,
                    'order.status': PAID,
                    'order.date_created.from': since.toISOString(),
                    offset,
                    limit: PAGE_SIZE,
                },
            });

            const parsed = pageSchema.safeParse(body);
            if (!parsed.success) {
                throw new MarketplaceRejectedError(`Unexpected order search: ${z.prettifyError(parsed.error)}`, this.marketplace);
            }

            const { results, paging } = parsed.data;
            orders.push(...translateOrders(this.marketplace, results, parseOrder, toCanonical, this.logger));

            offset += results.length;
            if (results.length === 0 || offset >= paging.total) {
                return orders;
            }
        }

        this.logger.warn({ marketplace: this.marketplace, pages: MAX_PAGES }, 'Order search cut at the maximum of pages');
        return orders;
    }

    async cancelOrder({ externalOrderId, reason }: CancelOrderRequest): Promise<void> {
        await this.http.send({
            method: 'PUT',
            path: `/orders/${encodeURIComponent(externalOrderId)}`,
            body: { status: 'cancelled', reason: reason ?? 'OTHER' },
        });
    }

}

function parseOrder(raw: unknown): MercadoLivreOrder | undefined {
    const parsed = orderSchema.safeParse(raw);

    if (!parsed.success) {
        throw new UntranslatableOrderError(z.prettifyError(parsed.error));
    }

    return parsed.data.status === PAID ? parsed.data : undefined;
}

function toCanonical(order: MercadoLivreOrder): CanonicalOrder {
    requireBrl(order.currency_id);

    return {
        externalOrderId: String(order.id),
        items: order.order_items.map(item => ({
            sku: item.item.seller_custom_field,
            quantity: item.quantity,
            unitPrice: item.unit_price,
        })),
        total: order.total_amount,
        // date_created carries the offset of the seller's time zone (-03:00): Date reads it into UTC.
        orderedAt: instantOf(order.date_created, 'date_created'),
    };
}
