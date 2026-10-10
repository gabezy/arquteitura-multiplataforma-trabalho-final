import path from "node:path";
import knex, { Knex } from "knex";
import { Id } from "../../core/shared/domain/id";
import { Price } from "../../core/shared/domain/price.vo";
import { Quantity } from "../../core/shared/domain/quantity.vo";
import { KnexProductRepository } from "./knex-product.repository";
import { NewProductProps, ProductEntity } from "../../core/product/model/product.entity";
import { ProductAnalysisStatus } from "../../core/product/model/product-analysis-status.vo";

const newProduct = (overrides: Partial<NewProductProps> = {}): ProductEntity =>
  ProductEntity.create({
    name: "Notebook",
    description: "Notebook 16GB RAM",
    price: new Price(4500.9),
    stock: new Quantity(10),
    ...overrides,
  });

const expectSameProduct = (actual: ProductEntity | null, expected: ProductEntity): void => {
  if (!actual) throw new Error(`Product ${expected.id.value} not found`);
  expect(actual.id.equals(expected.id)).toBe(true);
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
    await db.migrate.latest({
      directory: path.resolve(__dirname, "./migrations"),
      loadExtensions: [".ts"],
    });
    repository = new KnexProductRepository(db);
  });

  afterEach(async () => {
    await db("products").truncate();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("save", () => {
    it("persists a new product", async () => {
      const product = newProduct();

      await repository.save(product);

      expectSameProduct(await repository.findById(product.id), product);
    });

    it("updates an existing product with the same id", async () => {
      const product = newProduct();
      await repository.save(product);

      product.addStock(new Quantity(5));
      product.approveAnalysis();
      await repository.save(product);

      const found = await repository.findById(product.id);
      expect(found?.stock.value).toBe(15);
      expect(found?.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
      expect(await db("products").count({ total: "*" }).first()).toEqual({ total: 1 });
    });
  });

  describe("saveAll", () => {
    it("persists every product", async () => {
      const notebook = newProduct();
      const mouse = newProduct({ name: "Mouse", description: "Wireless mouse", price: new Price(99.9) });

      await repository.saveAll([notebook, mouse]);

      expectSameProduct(await repository.findById(notebook.id), notebook);
      expectSameProduct(await repository.findById(mouse.id), mouse);
    });

    it("updates products that already exist", async () => {
      const product = newProduct();
      await repository.save(product);

      product.rejectAnalysis();
      await repository.saveAll([product]);

      expect((await repository.findById(product.id))?.analysisStatus).toBe(ProductAnalysisStatus.REJECTED);
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
    });
  });

  describe("findById", () => {
    it("returns null when the product does not exist", async () => {
      expect(await repository.findById(new Id())).toBeNull();
    });

    it("throws when the stored analysis status is unknown", async () => {
      const product = newProduct();
      await repository.save(product);
      await db("products").where({ id: product.id.value }).update({ analysis_status: "UNKNOWN" });

      await expect(repository.findById(product.id)).rejects.toThrow("Invalid analysis status: UNKNOWN");
    });
  });
});
