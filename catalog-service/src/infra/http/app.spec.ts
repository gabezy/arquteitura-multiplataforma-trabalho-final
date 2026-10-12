import request from 'supertest';
import pino from 'pino';
import { createApp } from './app';
import { ProductController } from './product/product.controller';
import { AddProductPort } from '../../core/product/port/in/create-product.port';
import { FindProductPort, ProductOutput } from '../../core/product/port/in/find-product.port';
import { ImportProductsPort } from '../../core/product/port/in/import-products.port';
import { DuplicateSkuError, ProductNotFoundError } from '../../core/product/model/product.errors';

const PRODUCT_ID = '0b9f4c2e-6a1d-4f3b-9c8e-2d7a5e1f4b6c';

const product: ProductOutput = {
  id: PRODUCT_ID,
  sku: 'NB-001',
  name: 'Notebook',
  description: 'Notebook 16GB RAM',
  price: 4500,
  stock: 10,
  analysisStatus: 'PENDING',
};

const productInput = { sku: 'NB-001', name: 'Notebook', description: 'Notebook 16GB RAM', price: 4500, stock: 10 };

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
    addProductPort.add.mockResolvedValue({ id: PRODUCT_ID, sku: 'NB-001' });

    const response = await request(app).post('/products').send(productInput);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe('/products/sku/NB-001');
    expect(addProductPort.add).toHaveBeenCalledWith(productInput);
  });

  it('POST /products/import returns 201', async () => {
    importProductsPort.import.mockResolvedValue();

    const response = await request(app).post('/products/import').send({ items: [productInput] });

    expect(response.status).toBe(201);
    expect(importProductsPort.import).toHaveBeenCalledWith({ items: [productInput] });
  });

  it('GET /products/sku/:sku returns the product', async () => {
    findProductPort.find.mockResolvedValue(product);

    const response = await request(app).get('/products/sku/NB-001');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(product);
    expect(findProductPort.find).toHaveBeenCalledWith({ sku: 'NB-001' });
  });

  it('GET /products/sku/:sku returns 404 when the product does not exist', async () => {
    findProductPort.find.mockRejectedValue(new ProductNotFoundError('NB-001'));

    const response = await request(app).get('/products/sku/NB-001');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, detail: 'Product with SKU NB-001 not found.' });
  });

  it('POST /products returns 409 when the SKU already exists', async () => {
    addProductPort.add.mockRejectedValue(new DuplicateSkuError(['NB-001']));

    const response = await request(app).post('/products').send(productInput);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ status: 409, detail: 'Product with SKU NB-001 already exists.' });
  });

  it('POST /products drops fields that are not part of the input', async () => {
    addProductPort.add.mockResolvedValue({ id: PRODUCT_ID, sku: 'NB-001' });

    await request(app).post('/products').send({ ...productInput, id: 'forged', analysisStatus: 'APPROVED' });

    expect(addProductPort.add).toHaveBeenCalledWith(productInput);
  });

  it('POST /products returns 400 with every invalid field', async () => {
    const response = await request(app).post('/products').send({ name: 1, price: '10' });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 400, detail: 'Request validation failed.' });
    expect(response.body.errors.map((issue: { path: string }) => issue.path)).toEqual(
      expect.arrayContaining(['sku', 'name', 'description', 'price', 'stock']),
    );
    expect(addProductPort.add).not.toHaveBeenCalled();
  });

  it('POST /products leaves business rules to the domain', async () => {
    addProductPort.add.mockResolvedValue({ id: PRODUCT_ID, sku: 'NB-001' });

    const response = await request(app).post('/products').send({ ...productInput, sku: 'x', price: -1 });

    expect(response.status).toBe(201);
  });

  it.each([
    ['an empty list', { items: [] }],
    ['a missing list', {}],
    ['an invalid item', { items: [{ ...productInput, stock: 'ten' }] }],
  ])('POST /products/import returns 400 for %s', async (_case, body) => {
    const response = await request(app).post('/products/import').send(body);

    expect(response.status).toBe(400);
    expect(importProductsPort.import).not.toHaveBeenCalled();
  });

  it('POST /products/import reports the path of the invalid item', async () => {
    const response = await request(app)
      .post('/products/import')
      .send({ items: [productInput, { ...productInput, stock: 'ten' }] });

    expect(response.body.errors).toEqual([expect.objectContaining({ path: 'items.1.stock' })]);
  });

  it('returns 500 when a port fails', async () => {
    findProductPort.find.mockRejectedValue(new Error('boom'));

    const response = await request(app).get('/products/sku/NB-001');

    expect(response.status).toBe(500);
  });
});
