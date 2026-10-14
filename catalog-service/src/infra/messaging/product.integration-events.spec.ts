import { toProductIntegrationEvent } from "./product.integration-events";
import { ProductCreated } from "../../core/product/model/product-created.event";
import { ProductAnalysisApproved, ProductAnalysisRejected } from "../../core/product/model/product-analysis.events";
import { DomainEvent } from "../../core/shared/domain/domain.event";

const PRODUCT_ID = "0b9f4c2e-6a1d-4f3b-9c8e-2d7a5e1f4b6c";

class UnmappedEvent extends DomainEvent {
  readonly eventName = "UnmappedEvent";

  constructor() {
    super(PRODUCT_ID);
  }
}

describe("toProductIntegrationEvent", () => {
  it("maps ProductCreated to the public catalog.product.created.v1 contract", () => {
    const event = new ProductCreated(PRODUCT_ID, "NB-001", "Notebook", "Notebook 16GB RAM", 4500, 10);

    expect(toProductIntegrationEvent(event)).toEqual({
      type: "catalog.product.created.v1",
      data: {
        productId: PRODUCT_ID,
        sku: "NB-001",
        name: "Notebook",
        description: "Notebook 16GB RAM",
        price: 4500,
        stock: 10,
      },
    });
  });

  it("maps ProductAnalysisApproved to catalog.product.approved.v1", () => {
    expect(toProductIntegrationEvent(new ProductAnalysisApproved(PRODUCT_ID, "NB-001"))).toEqual({
      type: "catalog.product.approved.v1",
      data: { productId: PRODUCT_ID, sku: "NB-001" },
    });
  });

  it("maps ProductAnalysisRejected to catalog.product.rejected.v1", () => {
    expect(toProductIntegrationEvent(new ProductAnalysisRejected(PRODUCT_ID, "NB-001"))).toEqual({
      type: "catalog.product.rejected.v1",
      data: { productId: PRODUCT_ID, sku: "NB-001" },
    });
  });

  it("rejects an event that has no public contract", () => {
    expect(() => toProductIntegrationEvent(new UnmappedEvent())).toThrow(
      "No integration event for UnmappedEvent.",
    );
  });
});
