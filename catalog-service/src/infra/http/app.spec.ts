import request from 'supertest';
import pino from 'pino';
import { createApp } from './app';
import { ProductController } from './product/product.controller';
import { AddProductPort } from '../../core/product/port/in/create-product.port';
import { FindProductPort, ProductOutput } from '../../core/product/port/in/find-product.port';
import { ImportProductsPort } from '../../core/product/port/in/import-products.port';
import { ProductNotFoundError } from '../../core/product/model/product.errors';

const product: ProductOutput = {
  id: 'product-1',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 10,
  analysisStatus: 'PENDING',
};

const productInput = { name: 'Notebook', description: 'Notebook 16GB RAM', price: 4500, stock: 10 };

describe('app', () => {
  const addProductPort: jest.Mocked<AddProductPort> = { add: jest.fn() };
  const findProductPort: jest.Mocked<FindProductPort> = { find: jest.fn() };
  const importProductsPort: jest.Mocked<ImportProductsPort> = { import: jest.fn() };

  const app = createApp({
    logger: pino({ level: 'silent' }),
    productController: new ProductController(addProductPort, findProductPort, importProductsPort),
  });

  beforeEach(() => jest.resetAllMocks());

  it('GET /health returns UP', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP' });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown');

    expect(response.status).toBe(404);
  });

  it('POST /products returns 201 with the product location', async () => {
    addProductPort.add.mockResolvedValue({ id: 'product-1' });

    const response = await request(app).post('/products').send(productInput);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe('/products/product-1');
    expect(addProductPort.add).toHaveBeenCalledWith(productInput);
  });

  it('POST /products/import returns 201', async () => {
    importProductsPort.import.mockResolvedValue();

    const response = await request(app).post('/products/import').send({ items: [productInput] });

    expect(response.status).toBe(201);
    expect(importProductsPort.import).toHaveBeenCalledWith({ items: [productInput] });
  });

  it('GET /products/:id returns the product', async () => {
    findProductPort.find.mockResolvedValue(product);

    const response = await request(app).get('/products/product-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(product);
    expect(findProductPort.find).toHaveBeenCalledWith({ id: 'product-1' });
  });

  it('GET /products/:id returns 404 when the product does not exist', async () => {
    findProductPort.find.mockRejectedValue(new ProductNotFoundError('missing'));

    const response = await request(app).get('/products/missing');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, detail: 'Product with id missing not found.' });
  });

  it('returns 500 when a port fails', async () => {
    findProductPort.find.mockRejectedValue(new Error('boom'));

    const response = await request(app).get('/products/product-1');

    expect(response.status).toBe(500);
  });
});
