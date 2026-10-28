import { Router } from 'express';
import { validate } from '../validate';
import { OrderController } from './order.controller';
import { listOrdersQuerySchema, orderIdParamsSchema } from './order.schemas';

export const orderRoutes = (controller: OrderController): Router => {
    const router = Router();

    router.get('/orders', validate(listOrdersQuerySchema, 'query'), controller.listOrders);
    router.get('/orders/:id', validate(orderIdParamsSchema, 'params'), controller.findOrder);

    return router;
};
