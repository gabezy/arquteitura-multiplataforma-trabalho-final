import { Router } from 'express';
import { z } from 'zod';
import { MARKETPLACES } from '../../../core/order/model/marketplace';
import { ORDER_STATUSES } from '../../../core/order/model/order-status';
import { GetOrderPort } from '../../../core/order/port/in/get-order.port';
import { ListOrdersPort } from '../../../core/order/port/in/list-orders.port';
import { ValidationError } from '../../../core/shared/domain/domain.error';

// Answered as 422 by the error handler, which the BFF turns into its own 400.
export class InvalidRequestError extends ValidationError {}

const listOrdersQuery = z.object({
    marketplace: z.enum(MARKETPLACES).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

const orderIdParams = z.object({ id: z.uuid() });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new InvalidRequestError(z.prettifyError(result.error));
    }
    return result.data;
}

// The routes the BFF calls (docs/api-do-bff.md). Express 5 forwards a rejected handler to the error handler.
export function orderRoutes(listOrders: ListOrdersPort, getOrder: GetOrderPort): Router {
    const router = Router();

    router.get('/orders', async (req, res) => {
        const { marketplace, status, limit, offset } = parse(listOrdersQuery, req.query);
        const filter = { ...(marketplace && { marketplace }), ...(status && { status }) };

        const orders = await listOrders.list(filter, { limit, offset });

        res.json({ orders, limit, offset });
    });

    router.get('/orders/:id', async (req, res) => {
        const { id } = parse(orderIdParams, req.params);
        res.json(await getOrder.get(id));
    });

    return router;
}
