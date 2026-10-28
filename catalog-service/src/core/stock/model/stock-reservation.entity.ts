import { AggregateRoot } from "../../shared/domain/aggregate.root";
import { Id } from "../../shared/domain/id";
import { StockReservationStatus } from "./stock-reservation-status.vo";
import { ReservedItem, StockInsufficient, StockReserved, StockShortage } from "./stock-reservation.events";

export interface RestoreStockReservationProps {
    orderId: Id;
    items: ReservedItem[];
    status: StockReservationStatus;
}

// The catalog's answer to one order. There is one per order id, whatever the answer was,
// so a redelivered order event finds it and changes nothing.
export class StockReservation extends AggregateRoot<Id> {

    private readonly _items: ReservedItem[];
    private _status: StockReservationStatus;

    public static reserve(orderId: Id, items: ReservedItem[]): StockReservation {
        const reservation = new StockReservation({ orderId, items, status: StockReservationStatus.RESERVED });
        reservation.record(new StockReserved(orderId.value, items));
        return reservation;
    }

    public static reject(orderId: Id, shortages: StockShortage[]): StockReservation {
        const items = shortages.map(({ sku, requested }) => ({ sku, quantity: requested }));
        const reservation = new StockReservation({ orderId, items, status: StockReservationStatus.REJECTED });
        reservation.record(new StockInsufficient(orderId.value, shortages));
        return reservation;
    }

    // A tombstone: the order event that places this order may still arrive, and must then do nothing.
    public static cancelBeforePlaced(orderId: Id): StockReservation {
        return new StockReservation({ orderId, items: [], status: StockReservationStatus.CANCELLED });
    }

    public static restore(props: RestoreStockReservationProps): StockReservation {
        return new StockReservation(props);
    }

    private constructor(props: RestoreStockReservationProps) {
        super(props.orderId);
        this._items = props.items;
        this._status = props.status;

        this.validate();
    }

    protected validate(): void {}

    get orderId(): Id {
        return this.id;
    }

    get items(): ReservedItem[] {
        return this._items;
    }

    get status(): StockReservationStatus {
        return this._status;
    }

    // Only a reservation still holding stock has something to give back.
    release(): boolean {
        if (!this._status.equals(StockReservationStatus.RESERVED)) {
            return false;
        }
        this._status = StockReservationStatus.RELEASED;
        return true;
    }

}
