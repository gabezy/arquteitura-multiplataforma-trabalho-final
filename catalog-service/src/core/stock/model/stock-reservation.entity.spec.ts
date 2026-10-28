import { Id } from "../../shared/domain/id";
import { StockReservation } from "./stock-reservation.entity";
import { StockReservationStatus } from "./stock-reservation-status.vo";
import { StockInsufficient, StockReserved } from "./stock-reservation.events";

const ORDER_ID = "6f1c2b8e-0000-4000-8000-000000000001";

const restoreAs = (status: StockReservationStatus): StockReservation =>
  StockReservation.restore({ orderId: new Id(ORDER_ID), items: [{ sku: "NB-001", quantity: 1 }], status });

describe("StockReservation", () => {
  describe("reserve", () => {
    it("is reserved for the order and records the reserved items", () => {
      const reservation = StockReservation.reserve(new Id(ORDER_ID), [{ sku: "NB-001", quantity: 2 }]);

      expect(reservation.orderId.value).toBe(ORDER_ID);
      expect(reservation.status).toBe(StockReservationStatus.RESERVED);
      expect(reservation.items).toEqual([{ sku: "NB-001", quantity: 2 }]);
      const events = reservation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(StockReserved);
      expect(events[0]).toMatchObject({ aggregateId: ORDER_ID, items: [{ sku: "NB-001", quantity: 2 }] });
    });
  });

  describe("reject", () => {
    it("is rejected and records the shortages", () => {
      const shortages = [{ sku: "NB-001", requested: 2, available: 1 }];

      const reservation = StockReservation.reject(new Id(ORDER_ID), shortages);

      expect(reservation.status).toBe(StockReservationStatus.REJECTED);
      expect(reservation.items).toEqual([{ sku: "NB-001", quantity: 2 }]);
      const events = reservation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(StockInsufficient);
      expect(events[0]).toMatchObject({ aggregateId: ORDER_ID, items: shortages });
    });
  });

  describe("cancelBeforePlaced", () => {
    it("is cancelled with no items and records nothing", () => {
      const reservation = StockReservation.cancelBeforePlaced(new Id(ORDER_ID));

      expect(reservation.status).toBe(StockReservationStatus.CANCELLED);
      expect(reservation.items).toEqual([]);
      expect(reservation.pullDomainEvents()).toEqual([]);
    });
  });

  describe("restore", () => {
    it("records no event", () => {
      expect(restoreAs(StockReservationStatus.RESERVED).pullDomainEvents()).toEqual([]);
    });
  });

  describe("release", () => {
    it("releases a reserved order", () => {
      const reservation = restoreAs(StockReservationStatus.RESERVED);

      expect(reservation.release()).toBe(true);
      expect(reservation.status).toBe(StockReservationStatus.RELEASED);
    });

    it.each([StockReservationStatus.REJECTED, StockReservationStatus.RELEASED, StockReservationStatus.CANCELLED])(
      "does nothing when %p",
      (status) => {
        const reservation = restoreAs(status);

        expect(reservation.release()).toBe(false);
        expect(reservation.status).toBe(status);
      },
    );
  });
});
