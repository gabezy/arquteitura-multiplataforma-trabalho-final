import { Request, Response } from 'express';
import { QueryOrdersPort } from '../../../core/order/port/in/query-orders.port';

export class OrderController {

    constructor(private readonly queryOrders: QueryOrdersPort) {}

    // Dates leave as ISO-8601 in UTC and money as numbers in reais, which is how the BFF reads an order.
    findOrder = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
        res.status(200).json(await this.queryOrders.find(req.params.id));
    };

    // The query was parsed by `validate`, which left it in res.locals.
    listOrders = async (_req: Request, res: Response): Promise<void> => {
        res.status(200).json(await this.queryOrders.list(res.locals.query));
    };

}
