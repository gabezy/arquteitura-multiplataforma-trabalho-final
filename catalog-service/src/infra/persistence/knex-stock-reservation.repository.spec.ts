import knex, { Knex } from "knex";
import { ProductEntity } from "../../core/product/model/product.entity";
import { Sku } from "../../core/product/model/sku.vo";
import { Id } from "../../core/shared/domain/id";
import { Price } from "../../core/shared/domain/price.vo";
import { Quantity } from "../../core/shared/domain/quantity.vo";
import { StockReservation } from "../../core/stock/model/stock-reservation.entity";
import { StockReservationStatus } from "../../core/stock/model/stock-reservation-status.vo";
import { toProductIntegrationEvent } from "../messaging/product.integration-events";
import { toStockIntegrationEvent } from "../messaging/stock.integration-events";
import { ConcurrentModificationError } from "./concurrent-modification.error";
import { KnexOutboxRepository } from "./knex-outbox.repository";
import { KnexProductRepository } from "./knex-product.repository";
import { KnexStockReservationRepository } from "./knex-stock-reservation.repository";
import { createMigrationSource } from "./migration-source";

const ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";

describe("KnexStockReservationRepository", () => {
  let db: Knex;
  let products: KnexProductRepository;
  let repository: KnexStockReservationRepository;

  const storedProduct = async (stock: number): Promise<ProductEntity> => {
    const product = ProductEntity.create({
      sku: new Sku("NB-001"),
      name: "Notebook",
      description: "Notebook 16GB RAM",
      price: new Price(4500),
      stock: new Quantity(stock),
    });
    product.approveAnalysis();
    await products.save(product);
    await db("outbox").truncate();
    return (await products.findBySku(product.sku))!;
  };

  const outboxRows = () => db("outbox").select("event_type", "aggregate_type", "aggregate_id").orderBy("sequence");

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
    await db.migrate.latest({ migrationSource: createMigrationSource() });
    products = new KnexProductRepository(db, new KnexOutboxRepository(toProductIntegrationEvent));
    repository = new KnexStockReservationRepository(db, new KnexOutboxRepository(toStockIntegrationEvent));
  });

  afterEach(async () => {
    await db("products").truncate();
    await db("stock_reservations").truncate();
    await db("outbox").truncate();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("saves the reservation, the new stock and their events together", async () => {
    const product = await storedProduct(2);
    product.removeStock(new Quantity(1));

    await repository.save(StockReservation.reserve(new Id(ORDER_ID), [{ sku: "NB-001", quantity: 1 }]), [product]);

    const stored = await products.findBySku(product.sku);
    expect(stored?.stock.value).toBe(1);
    expect(stored?.version).toBe(1);
    const reservation = await repository.findByOrderId(new Id(ORDER_ID));
    expect(reservation?.status).toBe(StockReservationStatus.RESERVED);
    expect(reservation?.items).toEqual([{ sku: "NB-001", quantity: 1 }]);
    expect(await outboxRows()).toEqual([
      { event_type: "catalog.stock.reserved.v1", aggregate_type: "StockReservation", aggregate_id: ORDER_ID },
      { event_type: "catalog.product.stock-changed.v1", aggregate_type: "Product", aggregate_id: product.id.value },
    ]);
  });

  it("updates the reservation when it is released", async () => {
    const product = await storedProduct(2);
    product.removeStock(new Quantity(1));
    await repository.save(StockReservation.reserve(new Id(ORDER_ID), [{ sku: "NB-001", quantity: 1 }]), [product]);
    const reservation = (await repository.findByOrderId(new Id(ORDER_ID)))!;
    const reloaded = (await products.findBySku(product.sku))!;

    reservation.release();
    reloaded.addStock(new Quantity(1));
    await repository.save(reservation, [reloaded]);

    expect((await repository.findByOrderId(new Id(ORDER_ID)))?.status).toBe(StockReservationStatus.RELEASED);
    const stored = await products.findBySku(product.sku);
    expect(stored?.stock.value).toBe(2);
    expect(stored?.version).toBe(2);
    expect(await db("stock_reservations").count({ total: "*" }).first()).toEqual({ total: 1 });
  });

  it("saves nothing when the product was changed since it was read", async () => {
    const product = await storedProduct(2);
    await db("products").where({ id: product.id.value }).update({ version: 5 });
    product.removeStock(new Quantity(1));

    await expect(
      repository.save(StockReservation.reserve(new Id(ORDER_ID), [{ sku: "NB-001", quantity: 1 }]), [product]),
    ).rejects.toThrow(ConcurrentModificationError);

    expect((await products.findBySku(product.sku))?.stock.value).toBe(2);
    expect(await repository.findByOrderId(new Id(ORDER_ID))).toBeNull();
    expect(await outboxRows()).toEqual([]);
  });

  it("saves a rejected reservation with no products", async () => {
    await repository.save(StockReservation.reject(new Id(ORDER_ID), [{ sku: "NB-001", requested: 2, available: 1 }]), []);

    expect((await repository.findByOrderId(new Id(ORDER_ID)))?.status).toBe(StockReservationStatus.REJECTED);
    expect(await outboxRows()).toEqual([
      { event_type: "catalog.stock.insufficient.v1", aggregate_type: "StockReservation", aggregate_id: ORDER_ID },
    ]);
  });

  it("returns null for an order it has never seen", async () => {
    expect(await repository.findByOrderId(new Id(ORDER_ID))).toBeNull();
  });
});
