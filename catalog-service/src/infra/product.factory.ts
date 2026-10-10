import { Knex } from 'knex';
import { ProductFacade } from '../core/product/product.facade';
import { KnexProductRepository } from './persistence/knex-product.repository';
import { ProductController } from './http/product/product.controller';

export function createProductController(db: Knex): ProductController {
  const productFacade = new ProductFacade(new KnexProductRepository(db));
  return new ProductController(productFacade, productFacade, productFacade);
}
