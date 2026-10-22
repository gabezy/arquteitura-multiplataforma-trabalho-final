import { ValueObject } from "../../shared/domain/value.object";

export class StockReservationStatus implements ValueObject<StockReservationStatus, string> {

    private constructor(private readonly _value: string) {}

    static readonly RESERVED = new StockReservationStatus("RESERVED");
    static readonly REJECTED = new StockReservationStatus("REJECTED");
    static readonly RELEASED = new StockReservationStatus("RELEASED");
    // The order was cancelled before the catalog saw it placed.
    static readonly CANCELLED = new StockReservationStatus("CANCELLED");

    equals(vo?: StockReservationStatus | undefined): boolean {
        if (!vo) return false;
        return this._value === vo.value;
    }

    get value(): string {
        return this._value;
    }

}
