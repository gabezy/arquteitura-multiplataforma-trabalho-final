import { Request, Response } from 'express';
import { FindListingsPort, ListingView } from '../../../core/listing/port/in/find-listings.port';
import { parseRequest } from '../validate';
import { listingParamsSchema, listListingsQuerySchema } from './listing.schemas';

// The contract with the BFF (#35): the fields, in this order, and nothing else.
function toJson(listing: ListingView) {
  return {
    id: listing.id,
    sku: listing.sku,
    marketplace: listing.marketplace,
    externalListingId: listing.externalListingId,
    status: listing.status,
    price: listing.price,
    stock: listing.stock,
    failureReason: listing.failureReason,
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export class ListingController {

  constructor(private readonly findListingsPort: FindListingsPort) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const query = parseRequest(listListingsQuerySchema, req.query);
    const page = await this.findListingsPort.find(query);

    res.status(200).json({ listings: page.listings.map(toJson), limit: page.limit, offset: page.offset });
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseRequest(listingParamsSchema, req.params);

    res.status(200).json(toJson(await this.findListingsPort.findById(id)));
  };

}
