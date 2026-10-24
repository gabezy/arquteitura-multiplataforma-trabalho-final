import { z } from 'zod';
import { MARKETPLACES } from '../../../core/marketplace/model/marketplace';
import { LISTING_STATUSES } from '../../../core/listing/model/listing-status';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// The BFF may send the filters empty (?sku=&status=): an empty filter is no filter.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(value => (value === '' ? undefined : value), schema.optional());

// An integer written with digits only, so ' ', '1e2' and '-1' are refused instead of read as numbers.
const digits = z.string().regex(/^\d+$/, 'must be a whole number, zero or more').transform(Number);

export const listListingsQuerySchema = z.object({
  sku: optional(z.string().trim().min(1)),
  marketplace: optional(z.enum(MARKETPLACES)),
  status: optional(z.enum(LISTING_STATUSES)),
  limit: z.preprocess(
    value => (value === '' || value === undefined ? String(DEFAULT_LIMIT) : value),
    digits.pipe(z.number().int().min(1).max(MAX_LIMIT)),
  ),
  offset: z.preprocess(
    value => (value === '' || value === undefined ? '0' : value),
    digits.pipe(z.number().int().min(0)),
  ),
});

export const listingParamsSchema = z.object({
  id: z.uuid(),
});
