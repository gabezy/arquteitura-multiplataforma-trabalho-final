import { toStockIntegrationEvent } from "./stock.integration-events";
import { StockInsufficient, StockReserved } from "../../core/stock/model/stock-reservation.events";
import { ProductStockChanged } from "../../core/product/model/product-stock-changed.event";

const ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";
const PRODUCT_ID = "0b9f4c2e-6a1d-4f3b-9c8e-2d7a5e1f4b6c";

describe("toStockIntegrationEvent", () => {
  it("maps StockReserved to the public catalog.stock.reserved.v1 contract", () => {
    expect(toStockIntegrationEvent(new StockReserved(ORDER_ID, [{ sku: "NB-001", quantity: 1 }]))).toEqual({
      type: "catalog.stock.reserved.v1",
      data: { orderId: ORDER_ID, items: [{ sku: "NB-001", quantity: 1 }] },
    });
  });

  it("maps StockInsufficient to the public catalog.stock.insufficient.v1 contract", () => {
    const items = [{ sku: "NB-001", requested: 2, available: 1 }];

    expect(toStockIntegrationEvent(new StockInsufficient(ORDER_ID, items))).toEqual({
      type: "catalog.stock.insufficient.v1",
      data: { orderId: ORDER_ID, items },
    });
  });

  it("maps product events like the product mapper", () => {
    expect(toStockIntegrationEvent(new ProductStockChanged(PRODUCT_ID, "NB-001", 0))).toEqual({
      type: "catalog.product.stock-changed.v1",
      data: { productId: PRODUCT_ID, sku: "NB-001", stock: 0 },
    });
  });
});
