import { ValueObject } from "../../shared/domain/value.object";
import { InvalidOrderError } from "./order.errors";

export class OrderStatus implements ValueObject<OrderStatus, string> {

    private constructor(private readonly _value: string) {}

    static readonly RECEIVED = new OrderStatus("RECEIVED");
    static readonly CONFIRMED = new OrderStatus("CONFIRMED");
    static readonly PAID = new OrderStatus("PAID");
    static readonly CANCELLED = new OrderStatus("CANCELLED");
    static readonly ALL: readonly OrderStatus[] = [
        OrderStatus.RECEIVED, OrderStatus.CONFIRMED, OrderStatus.PAID, OrderStatus.CANCELLED,
    ];

    static of(value: string): OrderStatus {
        const status = OrderStatus.ALL.find(candidate => candidate._value === value);
        if (!status) {
            throw new InvalidOrderError(`Status must be one of ${OrderStatus.ALL.map(s => s.value).join(", ")}.`);
        }
        return status;
    }

    equals(vo?: OrderStatus): boolean {
        if (!vo) return false;
        return this._value === vo.value;
    }

    get value(): string {
        return this._value;
    }

}
