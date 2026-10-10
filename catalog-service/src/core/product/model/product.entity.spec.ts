import { Id } from "../../shared/domain/id";
import { Price } from "../../shared/domain/price.vo";
import { Quantity } from "../../shared/domain/quantity.vo";
import { ProductAnalysisStatus } from "./product-analysis-status.vo";
import { NewProductProps, ProductEntity } from "./product.entity";
import { InsufficientStockError, InvalidProductError } from "./product.errors";

const newProductProps = (overrides: Partial<NewProductProps> = {}): NewProductProps => ({
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
  });

describe("ProductEntity", () => {
  describe("create", () => {
    it("creates a product with the given props", () => {
      const price = new Price(4500);
      const stock = new Quantity(10);

      const product = ProductEntity.create(newProductProps({ price, stock }));

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

      const product = ProductEntity.restore({
        ...newProductProps({ price, stock }),
        id,
        analysisStatus: ProductAnalysisStatus.APPROVED,
      });

      expect(product.id).toBe(id);
      expect(product.name).toBe("Notebook");
      expect(product.description).toBe("Notebook 16GB RAM");
      expect(product.price).toBe(price);
      expect(product.stock).toBe(stock);
      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
    });

    it("rejects an invalid product", () => {
      expect(() => restoreWithId("product-1", { name: "" })).toThrow("Product name is required.");
    });
  });

  describe("addStock", () => {
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
    it("changes the analysis status to APPROVED", () => {
      const product = ProductEntity.create(newProductProps());

      product.approveAnalysis();

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.APPROVED);
    });
  });

  describe("rejectAnalysis", () => {
    it("changes the analysis status to REJECTED", () => {
      const product = ProductEntity.create(newProductProps());

      product.rejectAnalysis();

      expect(product.analysisStatus).toBe(ProductAnalysisStatus.REJECTED);
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
