import { ValueObject } from "../../shared/domain/value.object";
import { InvalidOrderError } from "./order.errors";

export class CancellationReason implements ValueObject<CancellationReason, string> {

    private constructor(private readonly _value: string) {}

    static readonly OUT_OF_STOCK = new CancellationReason("OUT_OF_STOCK");
    static readonly PAYMENT_FAILED = new CancellationReason("PAYMENT_FAILED");
    // The buyer cancelled at the marketplace. The model accepts it, but no event produces it yet.
    static readonly MARKETPLACE_CANCELLED = new CancellationReason("MARKETPLACE_CANCELLED");
    static readonly ALL: readonly CancellationReason[] = [
        CancellationReason.OUT_OF_STOCK, CancellationReason.PAYMENT_FAILED, CancellationReason.MARKETPLACE_CANCELLED,
    ];

    static of(value: string): CancellationReason {
        const reason = CancellationReason.ALL.find(candidate => candidate._value === value);
        if (!reason) {
            throw new InvalidOrderError(
                `Cancellation reason must be one of ${CancellationReason.ALL.map(r => r.value).join(", ")}.`,
            );
        }
        return reason;
    }

    equals(vo?: CancellationReason): boolean {
        if (!vo) return false;
        return this._value === vo.value;
    }

    get value(): string {
        return this._value;
    }

}
