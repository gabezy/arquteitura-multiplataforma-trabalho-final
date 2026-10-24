import { Router } from 'express';
import { ListingController } from './listing.controller';

export const listingRoutes = (controller: ListingController): Router => {
  const router = Router();

  router.get('/listings', controller.list);
  router.get('/listings/:id', controller.get);

  return router;
};
