import { Request, Response } from 'express';
import { SalesReportPort } from '../../../core/order/port/in/sales-report.port';

export class SalesReportController {

    constructor(private readonly salesReport: SalesReportPort) {}

    // The query was parsed by `validate`, which left it in res.locals.
    salesByMarketplace = async (_req: Request, res: Response): Promise<void> => {
        res.status(200).json(await this.salesReport.salesByMarketplace(res.locals.query));
    };

}
