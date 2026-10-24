import { Logger } from 'pino';
import { z } from 'zod';
import { Marketplace } from '../../core/marketplace/model/marketplace';
import { MarketplaceRejectedError } from '../../core/marketplace/model/marketplace.errors';
import { CancelOrderRequest, CanonicalOrder, MarketplacePort } from '../../core/marketplace/port/out/marketplace.port';
import { MarketplaceHttp } from './marketplace-http.client';
import { instantOf, MAX_PAGES, requireBrl, translateOrders, UntranslatableOrderError } from './order-translation';

const PAID = 'paid';
const PAGE_SIZE = 50;

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
