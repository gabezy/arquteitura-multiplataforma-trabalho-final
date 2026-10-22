import knex, { Knex } from "knex";
import { Price } from "../../core/shared/domain/price.vo";
import { Quantity } from "../../core/shared/domain/quantity.vo";
import { KnexProductRepository } from "./knex-product.repository";
import { KnexOutboxRepository } from "./knex-outbox.repository";
import { toProductIntegrationEvent } from "../messaging/product.integration-events";
import { createMigrationSource } from "./migration-source";
import { NewProductProps, ProductEntity } from "../../core/product/model/product.entity";
import { ProductAnalysisStatus } from "../../core/product/model/product-analysis-status.vo";
import { DuplicateSkuError } from "../../core/product/model/product.errors";
import { Sku } from "../../core/product/model/sku.vo";

let skuSequence = 0;

const newProduct = (overrides: Partial<NewProductProps> = {}): ProductEntity =>
  ProductEntity.create({
    sku: new Sku(`NB-${++skuSequence}`),
    name: "Notebook",
    description: "Notebook 16GB RAM",
    price: new Price(4500.9),
    stock: new Quantity(10),
    ...overrides,
  });

const expectSameProduct = (actual: ProductEntity | null, expected: ProductEntity): void => {
  if (!actual) throw new Error(`Product ${expected.id.value} not found`);
  expect(actual.id.equals(expected.id)).toBe(true);
  expect(actual.sku.equals(expected.sku)).toBe(true);
  expect(actual.name).toBe(expected.name);
  expect(actual.description).toBe(expected.description);
  expect(actual.price.value).toBe(expected.price.value);
  expect(actual.stock.value).toBe(expected.stock.value);
  expect(actual.analysisStatus).toBe(expected.analysisStatus);
};

describe("KnexProductRepository", () => {
  let db: Knex;
  let repository: KnexProductRepository;

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    repository = new KnexProductRepository(db, new KnexOutboxRepository(toProductIntegrationEvent));
  });

  afterEach(async () => {
    await db("products").truncate();
    await db("outbox").truncate();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("save", () => {
    it("persists a new product", async () => {
      const product = newProduct();

      await repository.save(product);

      expectSameProduct(await repository.findBySku(product.sku), product);
    });

    it("updates an existing product with the same id", async () => {
      const product = newProduct();
      await repository.save(product);

      product.approveAnalysis();
      await repository.save(product);

      const found = await repository.findBySku(product.sku);
      expect(found?.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
      expect(await db("products").count({ total: "*" }).first()).toEqual({ total: 1 });
    });

    it("rejects a product whose SKU belongs to another product", async () => {
      await repository.save(newProduct({ sku: new Sku("NB-DUP") }));

      await expect(repository.save(newProduct({ sku: new Sku("NB-DUP") }))).rejects.toThrow(
        new DuplicateSkuError(["NB-DUP"]),
      );
      expect(await db("products").count({ total: "*" }).first()).toEqual({ total: 1 });
    });

    it("writes the recorded events to the outbox as integration events", async () => {
      const product = newProduct();

      await repository.save(product);

      const rows = await db("outbox").select();
      expect(rows).toEqual([
        expect.objectContaining({
          aggregate_type: "Product",
          aggregate_id: product.id.value,
          event_type: "catalog.product.created.v1",
        }),
      ]);
      expect(JSON.parse(rows[0].payload)).toEqual({
        productId: product.id.value,
        sku: product.sku.value,
        name: "Notebook",
        description: "Notebook 16GB RAM",
        price: 4500.9,
        stock: 10,
      });
    });

    it("does not write the events again when the product is saved twice", async () => {
      const product = newProduct();

      await repository.save(product);
      await repository.save(product);

      expect(await db("outbox").count({ total: "*" }).first()).toEqual({ total: 1 });
    });

    it("writes no event when the product is rejected", async () => {
      await repository.save(newProduct({ sku: new Sku("NB-DUP") }));

      await expect(repository.save(newProduct({ sku: new Sku("NB-DUP") }))).rejects.toThrow(DuplicateSkuError);

      expect(await db("outbox").count({ total: "*" }).first()).toEqual({ total: 1 });
    });
  });

  describe("saveAll", () => {
    it("persists every product", async () => {
      const notebook = newProduct();
      const mouse = newProduct({ name: "Mouse", description: "Wireless mouse", price: new Price(99.9) });

      await repository.saveAll([notebook, mouse]);

      expectSameProduct(await repository.findBySku(notebook.sku), notebook);
      expectSameProduct(await repository.findBySku(mouse.sku), mouse);
    });

    it("updates products that already exist", async () => {
      const product = newProduct();
      await repository.save(product);

      product.rejectAnalysis();
      await repository.saveAll([product]);

      expect((await repository.findBySku(product.sku))?.analysisStatus).toBe(ProductAnalysisStatus.REJECTED);
    });

    it("does nothing when the list is empty", async () => {
      await repository.saveAll([]);

      expect(await db("products").count({ total: "*" }).first()).toEqual({ total: 0 });
    });

    it("persists nothing when one of the rows fails", async () => {
      await db.raw(`
        CREATE TRIGGER reject_broken_product BEFORE INSERT ON products
        WHEN NEW.name = 'Broken'
        BEGIN SELECT RAISE(ABORT, 'broken product'); END
      `);

      await expect(repository.saveAll([newProduct(), newProduct({ name: "Broken" })])).rejects.toThrow();

      await db.raw("DROP TRIGGER reject_broken_product");

      expect(await db("products").count({ total: "*" }).first()).toEqual({ total: 0 });
      expect(await db("outbox").count({ total: "*" }).first()).toEqual({ total: 0 });
    });

    it("writes the events of every product to the outbox", async () => {
      const notebook = newProduct();
      const mouse = newProduct();

      await repository.saveAll([notebook, mouse]);

      const rows = await db("outbox").select("aggregate_id").orderBy("sequence");
      expect(rows.map((row) => row.aggregate_id)).toEqual([notebook.id.value, mouse.id.value]);
    });

    it("rejects the batch when a SKU belongs to another product and persists nothing new", async () => {
      await repository.save(newProduct({ sku: new Sku("NB-DUP") }));

      await expect(
        repository.saveAll([newProduct({ sku: new Sku("NB-NEW") }), newProduct({ sku: new Sku("NB-DUP") })]),
      ).rejects.toThrow(new DuplicateSkuError(["NB-DUP"]));
      expect(await repository.findExistingSkus([new Sku("NB-NEW")])).toEqual([]);
    });

    it("rejects a batch that repeats a SKU", async () => {
      await expect(
        repository.saveAll([newProduct({ sku: new Sku("NB-DUP") }), newProduct({ sku: new Sku("NB-DUP") })]),
      ).rejects.toThrow(DuplicateSkuError);
    });
  });

  describe("stock and version", () => {
    it("does not overwrite the stored stock when saving an existing product", async () => {
      const product = newProduct({ stock: new Quantity(10) });
      await repository.save(product);
      const loaded = await repository.findBySku(product.sku);
      await db("products").where({ id: product.id.value }).update({ stock: 3 });

      loaded!.approveAnalysis();
      await repository.save(loaded!);

      const found = await repository.findBySku(product.sku);
      expect(found?.stock.value).toBe(3);
      expect(found?.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
    });

    it("starts a new product at version 0", async () => {
      const product = newProduct();
      await repository.save(product);

      expect((await repository.findBySku(product.sku))?.version).toBe(0);
    });

    it("restores the stored version", async () => {
      const product = newProduct();
      await repository.save(product);
      await db("products").where({ id: product.id.value }).update({ version: 4 });

      expect((await repository.findBySku(product.sku))?.version).toBe(4);
    });
  });

  describe("findBySkus", () => {
    it("returns the stored products, ignoring unknown SKUs", async () => {
      const a = newProduct();
      const b = newProduct();
      await repository.saveAll([a, b]);

      const found = await repository.findBySkus([a.sku, b.sku, new Sku("ZZ-999")]);

      expect(found.map((product) => product.sku.value).sort()).toEqual([a.sku.value, b.sku.value].sort());
    });

    it("returns an empty list for no SKUs", async () => {
      expect(await repository.findBySkus([])).toEqual([]);
    });
  });

  describe("findExistingSkus", () => {
    it("returns only the SKUs that are already stored", async () => {
      await repository.saveAll([newProduct({ sku: new Sku("NB-A") }), newProduct({ sku: new Sku("NB-B") })]);

      const found = await repository.findExistingSkus([new Sku("NB-A"), new Sku("NB-C")]);

      expect(found.map((sku) => sku.value)).toEqual(["NB-A"]);
    });

    it("returns an empty list for no SKUs", async () => {
      expect(await repository.findExistingSkus([])).toEqual([]);
    });
  });

  describe("findBySku", () => {
    it("returns null when the product does not exist", async () => {
      expect(await repository.findBySku(new Sku("NB-NOEXIST"))).toBeNull();
    });

    it("throws when the stored analysis status is unknown", async () => {
      const product = newProduct();
      await repository.save(product);
      await db("products").where({ id: product.id.value }).update({ analysis_status: "UNKNOWN" });

      await expect(repository.findBySku(product.sku)).rejects.toThrow("Invalid analysis status: UNKNOWN");
    });
  });
});
