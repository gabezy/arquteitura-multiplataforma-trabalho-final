import { Router } from 'express';
import { validate } from '../validate';
import { SalesReportController } from './sales-report.controller';
import { salesReportQuerySchema } from './sales-report.schemas';

export const salesReportRoutes = (controller: SalesReportController): Router => {
    const router = Router();

    router.get('/reports/sales-by-marketplace', validate(salesReportQuerySchema, 'query'), controller.salesByMarketplace);

    return router;
};
