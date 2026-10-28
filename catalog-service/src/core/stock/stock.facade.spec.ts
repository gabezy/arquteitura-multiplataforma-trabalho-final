import { ProductEntity } from "../product/model/product.entity";
import { ProductStockChanged } from "../product/model/product-stock-changed.event";
import { Sku } from "../product/model/sku.vo";
import { ProductRepositoryPort } from "../product/port/out/product.repository";
import { DomainEvent } from "../shared/domain/domain.event";
import { Id } from "../shared/domain/id";
import { Price } from "../shared/domain/price.vo";
import { Quantity } from "../shared/domain/quantity.vo";
import { StockReservation } from "./model/stock-reservation.entity";
import { StockReservationStatus } from "./model/stock-reservation-status.vo";
import { StockInsufficient, StockReserved } from "./model/stock-reservation.events";
import { StockReservationRepositoryPort } from "./port/out/stock-reservation.repository";
import { StockFacade } from "./stock.facade";

const ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";

// Hands out copies, like a database, so a product changed but never saved keeps its stored stock.
const copy = (product: ProductEntity): ProductEntity =>
  ProductEntity.restore({
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: product.price,
    stock: product.stock,
    analysisStatus: product.analysisStatus,
    version: product.version,
  });

class InMemoryProductRepository implements Pick<ProductRepositoryPort, "findBySkus"> {
  readonly products = new Map<string, ProductEntity>();

  async findBySkus(skus: Sku[]): Promise<ProductEntity[]> {
    return [...this.products.values()].filter((product) => skus.some((sku) => sku.equals(product.sku))).map(copy);
  }

  stockOf(sku: string): number {
    return [...this.products.values()].find((product) => product.sku.value === sku)!.stock.value;
  }
}

class InMemoryStockReservationRepository implements StockReservationRepositoryPort {
  readonly reservations = new Map<string, StockReservation>();
  readonly saves: { status: StockReservationStatus; products: string[]; events: DomainEvent[] }[] = [];

  constructor(private readonly productRepository: InMemoryProductRepository) {}

  async findByOrderId(orderId: Id): Promise<StockReservation | null> {
    return this.reservations.get(orderId.value) ?? null;
  }

  async save(reservation: StockReservation, products: ProductEntity[]): Promise<void> {
    const events = [...reservation.pullDomainEvents(), ...products.flatMap((product) => product.pullDomainEvents())];
    this.saves.push({ status: reservation.status, products: products.map((product) => product.sku.value), events });
    this.reservations.set(reservation.orderId.value, reservation);
    products.forEach((product) => this.productRepository.products.set(product.id.value, copy(product)));
  }
}

describe("StockFacade", () => {
  let products: InMemoryProductRepository;
  let reservations: InMemoryStockReservationRepository;
  let facade: StockFacade;

  const addProduct = (sku: string, stock: number, approved = true): void => {
    const product = ProductEntity.create({
      sku: new Sku(sku),
      name: "Notebook",
      description: "Notebook 16GB RAM",
      price: new Price(4500),
      stock: new Quantity(stock),
    });
    if (approved) product.approveAnalysis();
    products.products.set(product.id.value, copy(product));
  };

  const placed = (...items: [string, number][]) =>
    facade.reserve({ orderId: ORDER_ID, items: items.map(([sku, quantity]) => ({ sku, quantity })) });

  beforeEach(() => {
    products = new InMemoryProductRepository();
    reservations = new InMemoryStockReservationRepository(products);
    facade = new StockFacade(products as unknown as ProductRepositoryPort, reservations);
  });

  describe("reserve", () => {
    it("removes the ordered quantity and records the reservation", async () => {
      addProduct("NB-001", 2);

      await placed(["NB-001", 1]);

      expect(products.stockOf("NB-001")).toBe(1);
      expect(reservations.saves).toHaveLength(1);
      const [save] = reservations.saves;
      expect(save.status).toBe(StockReservationStatus.RESERVED);
      expect(save.events[0]).toBeInstanceOf(StockReserved);
      expect(save.events[0]).toMatchObject({ aggregateId: ORDER_ID, items: [{ sku: "NB-001", quantity: 1 }] });
      expect(save.events[1]).toBeInstanceOf(ProductStockChanged);
      expect(save.events[1]).toMatchObject({ sku: "NB-001", stock: 1 });
    });

    it("rejects the order when the stock is insufficient, keeping the stock", async () => {
      addProduct("NB-001", 1);

      await placed(["NB-001", 2]);

      expect(products.stockOf("NB-001")).toBe(1);
      const [save] = reservations.saves;
      expect(save.status).toBe(StockReservationStatus.REJECTED);
      expect(save.products).toEqual([]);
      expect(save.events).toHaveLength(1);
      expect(save.events[0]).toBeInstanceOf(StockInsufficient);
      expect(save.events[0]).toMatchObject({ items: [{ sku: "NB-001", requested: 2, available: 1 }] });
    });

    it("reserves nothing when one of the items is short", async () => {
      addProduct("NB-001", 5);
      addProduct("NB-002", 1);

      await placed(["NB-001", 1], ["NB-002", 3]);

      expect(products.stockOf("NB-001")).toBe(5);
      expect(products.stockOf("NB-002")).toBe(1);
      expect(reservations.saves[0].events[0]).toMatchObject({ items: [{ sku: "NB-002", requested: 3, available: 1 }] });
    });

    it("treats an unknown product and one not approved as having no stock", async () => {
      addProduct("NB-001", 5, false);

      await placed(["NB-001", 1], ["NB-404", 1]);

      expect(reservations.saves[0].events[0]).toMatchObject({
        items: [
          { sku: "NB-001", requested: 1, available: 0 },
          { sku: "NB-404", requested: 1, available: 0 },
        ],
      });
    });

    it("answers a malformed SKU as having no stock", async () => {
      await placed(["sku 1!", 1]);

      expect(reservations.saves[0].status).toBe(StockReservationStatus.REJECTED);
      expect(reservations.saves[0].events[0]).toMatchObject({ items: [{ sku: "sku 1!", requested: 1, available: 0 }] });
    });

    it("adds up the lines of the same SKU, whatever the case", async () => {
      addProduct("NB-001", 3);

      await placed(["nb-001", 1], ["NB-001", 2]);

      expect(products.stockOf("NB-001")).toBe(0);
      expect(reservations.saves[0].events[0]).toMatchObject({ items: [{ sku: "NB-001", quantity: 3 }] });
    });

    it("removes the stock only once when the order is delivered twice", async () => {
      addProduct("NB-001", 2);

      await placed(["NB-001", 1]);
      await placed(["NB-001", 1]);

      expect(products.stockOf("NB-001")).toBe(1);
      expect(reservations.saves).toHaveLength(1);
    });
  });

  describe("release", () => {
    const cancelled = () => facade.release({ orderId: ORDER_ID });

    it("gives the stock of a reserved order back", async () => {
      addProduct("NB-001", 2);
      await placed(["NB-001", 1]);

      await cancelled();

      expect(products.stockOf("NB-001")).toBe(2);
      const save = reservations.saves[1];
      expect(save.status).toBe(StockReservationStatus.RELEASED);
      expect(save.events).toHaveLength(1);
      expect(save.events[0]).toBeInstanceOf(ProductStockChanged);
      expect(save.events[0]).toMatchObject({ sku: "NB-001", stock: 2 });
    });

    it("gives the stock back only once when the cancellation is delivered twice", async () => {
      addProduct("NB-001", 2);
      await placed(["NB-001", 1]);

      await cancelled();
      await cancelled();

      expect(products.stockOf("NB-001")).toBe(2);
      expect(reservations.saves).toHaveLength(2);
    });

    it("does nothing for a rejected order", async () => {
      addProduct("NB-001", 1);
      await placed(["NB-001", 2]);

      await cancelled();

      expect(products.stockOf("NB-001")).toBe(1);
      expect(reservations.saves).toHaveLength(1);
    });

    it("remembers an order cancelled before it was placed, so placing it later changes nothing", async () => {
      addProduct("NB-001", 2);

      await cancelled();
      await placed(["NB-001", 1]);

      expect(products.stockOf("NB-001")).toBe(2);
      expect(reservations.saves).toHaveLength(1);
      expect(reservations.saves[0].status).toBe(StockReservationStatus.CANCELLED);
      expect(reservations.saves[0].events).toEqual([]);
    });
  });
});
