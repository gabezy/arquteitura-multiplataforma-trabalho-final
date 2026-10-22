import { Id } from "../../shared/domain/id";
import { Price } from "../../shared/domain/price.vo";
import { Quantity } from "../../shared/domain/quantity.vo";
import { ProductAnalysisStatus } from "./product-analysis-status.vo";
import { NewProductProps, ProductEntity } from "./product.entity";
import { AnalysisAlreadyCompletedError, InsufficientStockError, InvalidProductError } from "./product.errors";
import { ProductCreated } from "./product-created.event";
import { ProductAnalysisApproved, ProductAnalysisRejected } from "./product-analysis.events";
import { ProductStockChanged } from "./product-stock-changed.event";
import { Sku } from "./sku.vo";

const newProductProps = (overrides: Partial<NewProductProps> = {}): NewProductProps => ({
  sku: new Sku("NB-001"),
  name: "Notebook",
  description: "Notebook 16GB RAM",
  price: new Price(4500),
  stock: new Quantity(10),
  ...overrides,
});

const productWithStock = (stock: number): ProductEntity =>
  ProductEntity.create(newProductProps({ stock: new Quantity(stock) }));

const restoreWithId = (id: string, overrides: Partial<NewProductProps> = {}): ProductEntity =>
  ProductEntity.restore({
    ...newProductProps(overrides),
    id: new Id(id),
    analysisStatus: ProductAnalysisStatus.PENDING,
    version: 0,
  });

const productWithAnalysis = (analysisStatus: ProductAnalysisStatus): ProductEntity =>
  ProductEntity.restore({ ...newProductProps(), id: new Id("product-1"), analysisStatus, version: 0 });

describe("ProductEntity", () => {
  describe("create", () => {
    it("creates a product with the given props", () => {
      const price = new Price(4500);
      const stock = new Quantity(10);

      const sku = new Sku("NB-001");

      const product = ProductEntity.create(newProductProps({ sku, price, stock }));

      expect(product.sku).toBe(sku);
      expect(product.name).toBe("Notebook");
      expect(product.description).toBe("Notebook 16GB RAM");
      expect(product.price).toBe(price);
      expect(product.stock).toBe(stock);
    });

    it("generates an id", () => {
      const product = ProductEntity.create(newProductProps());

      expect(product.id).toBeInstanceOf(Id);
      expect(product.id.value).toEqual(expect.any(String));
    });

    it("starts with PENDING analysis status", () => {
      const product = ProductEntity.create(newProductProps());

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.PENDING);
    });

    it("records that the product was created", () => {
      const product = ProductEntity.create(newProductProps());

      const events = product.pullDomainEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ProductCreated);
      expect(events[0]).toMatchObject({
        eventName: "ProductCreated",
        aggregateId: product.id.value,
        sku: "NB-001",
        name: "Notebook",
        description: "Notebook 16GB RAM",
        price: 4500,
        stock: 10,
      });
    });

    it("hands out its events only once", () => {
      const product = ProductEntity.create(newProductProps());

      product.pullDomainEvents();

      expect(product.pullDomainEvents()).toEqual([]);
    });

    it("accepts zero stock", () => {
      expect(() => productWithStock(0)).not.toThrow();
    });

    it("accepts zero price", () => {
      expect(() => ProductEntity.create(newProductProps({ price: new Price(0) }))).not.toThrow();
    });

    it.each(["", "   "])("rejects name %p", (name) => {
      expect(() => ProductEntity.create(newProductProps({ name }))).toThrow("Product name is required.");
      expect(() => ProductEntity.create(newProductProps({ name }))).toThrow(InvalidProductError);
    });

    it.each(["", "   "])("rejects description %p", (description) => {
      expect(() => ProductEntity.create(newProductProps({ description }))).toThrow(
        "Product description is required.",
      );
    });
  });

  describe("restore", () => {
    it("restores a product with its id and analysis status", () => {
      const id = new Id("product-1");
      const price = new Price(4500);
      const stock = new Quantity(10);
      const sku = new Sku("NB-001");

      const product = ProductEntity.restore({
        ...newProductProps({ sku, price, stock }),
        id,
        analysisStatus: ProductAnalysisStatus.APPROVED,
        version: 3,
      });

      expect(product.id).toBe(id);
      expect(product.sku).toBe(sku);
      expect(product.name).toBe("Notebook");
      expect(product.description).toBe("Notebook 16GB RAM");
      expect(product.price).toBe(price);
      expect(product.stock).toBe(stock);
      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
      expect(product.version).toBe(3);
    });

    it("records no event", () => {
      expect(restoreWithId("product-1").pullDomainEvents()).toEqual([]);
    });

    it("rejects an invalid product", () => {
      expect(() => restoreWithId("product-1", { name: "" })).toThrow("Product name is required.");
    });
  });

  describe("version", () => {
    it("starts at 0 for a new product", () => {
      expect(productWithStock(10).version).toBe(0);
    });
  });

  describe("isAvailableForOrders", () => {
    it.each([
      [ProductAnalysisStatus.APPROVED, true],
      [ProductAnalysisStatus.PENDING, false],
      [ProductAnalysisStatus.REJECTED, false],
    ])("is %p available: %p", (status, available) => {
      expect(productWithAnalysis(status).isAvailableForOrders()).toBe(available);
    });
  });

  describe("addStock", () => {
    it("records the new stock", () => {
      const product = productWithStock(10);
      product.pullDomainEvents();

      product.addStock(new Quantity(5));

      const events = product.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ProductStockChanged);
      expect(events[0]).toMatchObject({ aggregateId: product.id.value, sku: "NB-001", stock: 15 });
    });

    it("increases the stock by the given quantity", () => {
      const product = productWithStock(10);

      product.addStock(new Quantity(5));

      expect(product.stock.value).toBe(15);
    });

    it("rejects a zero quantity", () => {
      const product = productWithStock(10);

      expect(() => product.addStock(new Quantity(0))).toThrow("Quantity to add must be greater than zero.");
      expect(product.stock.value).toBe(10);
    });
  });

  describe("removeStock", () => {
    it("records the new stock", () => {
      const product = productWithStock(10);
      product.pullDomainEvents();

      product.removeStock(new Quantity(4));

      const events = product.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ProductStockChanged);
      expect(events[0]).toMatchObject({ aggregateId: product.id.value, sku: "NB-001", stock: 6 });
    });

    it("records nothing when the stock is insufficient", () => {
      const product = productWithStock(10);
      product.pullDomainEvents();

      expect(() => product.removeStock(new Quantity(11))).toThrow(InsufficientStockError);
      expect(product.pullDomainEvents()).toEqual([]);
    });

    it("decreases the stock by the given quantity", () => {
      const product = productWithStock(10);

      product.removeStock(new Quantity(4));

      expect(product.stock.value).toBe(6);
    });

    it("allows removing all the stock", () => {
      const product = productWithStock(10);

      product.removeStock(new Quantity(10));

      expect(product.stock.value).toBe(0);
    });

    it("rejects a zero quantity", () => {
      const product = productWithStock(10);

      expect(() => product.removeStock(new Quantity(0))).toThrow("Quantity to remove must be greater than zero.");
      expect(product.stock.value).toBe(10);
    });

    it("rejects removing more than the available stock", () => {
      const product = productWithStock(10);

      expect(() => product.removeStock(new Quantity(11))).toThrow(
        "Insufficient stock to remove the specified quantity.",
      );
      expect(() => product.removeStock(new Quantity(11))).toThrow(InsufficientStockError);
      expect(product.stock.value).toBe(10);
    });
  });

  describe("approveAnalysis", () => {
    it("approves a product pending analysis", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.PENDING);

      product.approveAnalysis();

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
    });

    it("records that the analysis was approved", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.PENDING);

      product.approveAnalysis();

      const events = product.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ProductAnalysisApproved);
      expect(events[0]).toMatchObject({ aggregateId: "product-1", sku: "NB-001" });
    });

    it("ignores an approval of an already approved product", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.APPROVED);

      product.approveAnalysis();

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
      expect(product.pullDomainEvents()).toEqual([]);
    });

    it("rejects approving a rejected product", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.REJECTED);

      expect(() => product.approveAnalysis()).toThrow(AnalysisAlreadyCompletedError);
      expect(() => product.approveAnalysis()).toThrow("Analysis of product NB-001 was already completed as REJECTED.");
      expect(product.analysisStatus).toBe(ProductAnalysisStatus.REJECTED);
      expect(product.pullDomainEvents()).toEqual([]);
    });
  });

  describe("rejectAnalysis", () => {
    it("rejects a product pending analysis", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.PENDING);

      product.rejectAnalysis();

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.REJECTED);
    });

    it("records that the analysis was rejected", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.PENDING);

      product.rejectAnalysis();

      const events = product.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ProductAnalysisRejected);
      expect(events[0]).toMatchObject({ aggregateId: "product-1", sku: "NB-001" });
    });

    it("ignores a rejection of an already rejected product", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.REJECTED);

      product.rejectAnalysis();

      expect(product.pullDomainEvents()).toEqual([]);
    });

    it("rejects rejecting an approved product", () => {
      const product = productWithAnalysis(ProductAnalysisStatus.APPROVED);

      expect(() => product.rejectAnalysis()).toThrow(AnalysisAlreadyCompletedError);
      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
    });
  });

  describe("equals", () => {
    it("is equal to another product with the same id", () => {
      expect(restoreWithId("product-1").equals(restoreWithId("product-1", { name: "Other" }))).toBe(true);
    });

    it("is not equal to a product with a different id", () => {
      expect(restoreWithId("product-1").equals(restoreWithId("product-2"))).toBe(false);
    });

    it("is not equal to undefined", () => {
      expect(restoreWithId("product-1").equals(undefined)).toBe(false);
    });
  });
});
