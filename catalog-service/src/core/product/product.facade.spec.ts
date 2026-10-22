import { ProductEntity } from "./model/product.entity";
import { AnalysisAlreadyCompletedError, DuplicateSkuError, InvalidProductError, ProductNotFoundError } from "./model/product.errors";
import { Sku } from "./model/sku.vo";
import { AddProductPortInput } from "./port/in/create-product.port";
import { ProductRepositoryPort } from "./port/out/product.repository";
import { ProductFacade } from "./product.facade";

class InMemoryProductRepository implements ProductRepositoryPort {
  readonly products = new Map<string, ProductEntity>();

  async save(product: ProductEntity): Promise<void> {
    this.products.set(product.id.value, product);
  }

  async saveAll(products: ProductEntity[]): Promise<void> {
    products.forEach((product) => this.products.set(product.id.value, product));
  }

  async findBySku(sku: Sku): Promise<ProductEntity | null> {
    return [...this.products.values()].find((product) => product.sku.equals(sku)) ?? null;
  }

  async findBySkus(skus: Sku[]): Promise<ProductEntity[]> {
    return [...this.products.values()].filter((product) => skus.some((sku) => sku.equals(product.sku)));
  }

  async findExistingSkus(skus: Sku[]): Promise<Sku[]> {
    const stored = [...this.products.values()].map((product) => product.sku);
    return skus.filter((sku) => stored.some((existing) => existing.equals(sku)));
  }
}

const productInput = (overrides: Partial<AddProductPortInput> = {}): AddProductPortInput => ({
  sku: "NB-001",
  name: "Notebook",
  description: "Notebook 16GB RAM",
  price: 4500,
  stock: 10,
  ...overrides,
});

describe("ProductFacade", () => {
  let repository: InMemoryProductRepository;
  let facade: ProductFacade;

  beforeEach(() => {
    repository = new InMemoryProductRepository();
    facade = new ProductFacade(repository);
  });

  describe("add", () => {
    it("saves the product and returns its id and SKU", async () => {
      const { id, sku } = await facade.add(productInput());

      expect(await facade.find({ sku })).toEqual({
        id,
        sku: "NB-001",
        name: "Notebook",
        description: "Notebook 16GB RAM",
        price: 4500,
        stock: 10,
        analysisStatus: "PENDING",
      });
    });

    it("stores the SKU in upper case", async () => {
      const { sku } = await facade.add(productInput({ sku: "nb-001" }));

      expect(sku).toBe("NB-001");
    });

    it("rejects a SKU that already exists", async () => {
      await facade.add(productInput());

      await expect(facade.add(productInput({ name: "Other" }))).rejects.toThrow(DuplicateSkuError);
      expect(repository.products.size).toBe(1);
    });

    it("rejects a SKU that differs from an existing one only by case", async () => {
      await facade.add(productInput({ sku: "NB-001" }));

      await expect(facade.add(productInput({ sku: "nb-001" }))).rejects.toThrow(
        "Product with SKU NB-001 already exists.",
      );
    });

    it("rejects an invalid SKU", async () => {
      await expect(facade.add(productInput({ sku: "x" }))).rejects.toThrow(InvalidProductError);
    });
  });

  describe("import", () => {
    it("saves every product", async () => {
      await facade.import({ items: [productInput({ sku: "NB-001" }), productInput({ sku: "NB-002" })] });

      expect(repository.products.size).toBe(2);
    });

    it("rejects SKUs repeated inside the batch and saves nothing", async () => {
      const items = [productInput({ sku: "NB-001" }), productInput({ sku: "nb-001" }), productInput({ sku: "NB-002" })];

      await expect(facade.import({ items })).rejects.toThrow("Product with SKU NB-001 already exists.");
      expect(repository.products.size).toBe(0);
    });

    it("rejects SKUs that already exist and saves nothing", async () => {
      await facade.add(productInput({ sku: "NB-001" }));

      const items = [productInput({ sku: "NB-001" }), productInput({ sku: "NB-002" })];

      await expect(facade.import({ items })).rejects.toThrow(DuplicateSkuError);
      expect(repository.products.size).toBe(1);
    });
  });

  describe("find", () => {
    it("finds the product regardless of the SKU case", async () => {
      await facade.add(productInput({ sku: "NB-001" }));

      expect((await facade.find({ sku: "nb-001" })).sku).toBe("NB-001");
    });

    it("throws when the product does not exist", async () => {
      await expect(facade.find({ sku: "ARB-2131" })).rejects.toThrow(ProductNotFoundError);
    });
  });

  describe("completeAnalysis", () => {
    it.each([
      ["APPROVED", "APPROVED"],
      ["REJECTED", "REJECTED"],
    ] as const)("stores a %s analysis", async (status, expected) => {
      await facade.add(productInput());

      await facade.completeAnalysis({ sku: "NB-001", status });

      expect((await facade.find({ sku: "NB-001" })).analysisStatus).toBe(expected);
    });

    it("throws when the product does not exist", async () => {
      await expect(facade.completeAnalysis({ sku: "ARB-2131", status: "APPROVED" })).rejects.toThrow(
        ProductNotFoundError,
      );
    });

    it("throws when the analysis was already completed with another result", async () => {
      await facade.add(productInput());
      await facade.completeAnalysis({ sku: "NB-001", status: "APPROVED" });

      await expect(facade.completeAnalysis({ sku: "NB-001", status: "REJECTED" })).rejects.toThrow(
        AnalysisAlreadyCompletedError,
      );
    });
  });
});
