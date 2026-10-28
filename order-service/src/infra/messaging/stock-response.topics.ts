import { z } from 'zod';
import { ApplyStockOutcomePort } from '../../core/order/port/in/apply-stock-outcome.port';
import { outcomeTopic, OutcomeTopic } from './order-outcome.consumer';

export const STOCK_RESPONSE_SOURCE = '/catalog-service';
export const STOCK_RESPONSE_DEAD_LETTER_TOPIC = 'order.stock-response.dlq';

// catalog.stock.reserved.v1 and catalog.stock.insufficient.v1 (docs/eventos.md), keyed by orderId. Only the
// order id is used; the items only have to be there.
const stockResponseSchema = z.object({
    orderId: z.uuid(),
    items: z.array(z.object({ sku: z.string().min(1) })).min(1),
});

type StockResponse = z.infer<typeof stockResponseSchema>;

export function stockResponseTopics(port: ApplyStockOutcomePort): Record<string, OutcomeTopic<unknown>> {
    const topic = (apply: (data: StockResponse) => Promise<void>) =>
        outcomeTopic<StockResponse>({ schema: stockResponseSchema, subject: data => data.orderId, apply });

    return {
        'catalog.stock.reserved.v1': topic(({ orderId }) => port.applyStockReserved({ orderId })),
        'catalog.stock.insufficient.v1': topic(({ orderId }) => port.applyStockInsufficient({ orderId })),
    };
}
