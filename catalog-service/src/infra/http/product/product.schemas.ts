import { z } from 'zod';
import { AddProductPortInput } from '../../../core/product/port/in/create-product.port';
import { FindProductPortInput } from '../../../core/product/port/in/find-product.port';
import { ImportProductsPortInput } from '../../../core/product/port/in/import-products.port';

// Checks only the shape of the request. Business rules (SKU format, non-negative
// price, ...) belong to the domain, so they are not repeated here.
const productSchema = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.number(),
  stock: z.number(),
});

export const addProductSchema = productSchema satisfies z.ZodType<AddProductPortInput>;

export const importProductsSchema = z.object({
  items: z.array(productSchema).min(1).max(1000),
}) satisfies z.ZodType<ImportProductsPortInput>;

export const productSkuParamsSchema = z.object({
  sku: z.string(),
}) satisfies z.ZodType<FindProductPortInput>;
