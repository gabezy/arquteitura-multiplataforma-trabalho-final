import { ValueObject } from "../../shared/domain/value.object";
import { InvalidOrderError } from "./order.errors";

export class Marketplace implements ValueObject<Marketplace, string> {

    private constructor(private readonly _value: string) {}

    static readonly AMAZON = new Marketplace("AMAZON");
    static readonly MERCADO_LIVRE = new Marketplace("MERCADO_LIVRE");
    static readonly SHOPEE = new Marketplace("SHOPEE");
    static readonly ALL: readonly Marketplace[] = [Marketplace.AMAZON, Marketplace.MERCADO_LIVRE, Marketplace.SHOPEE];

    static of(value: string): Marketplace {
        const marketplace = Marketplace.ALL.find(candidate => candidate._value === value);
        if (!marketplace) {
            throw new InvalidOrderError(`Marketplace must be one of ${Marketplace.ALL.map(m => m.value).join(", ")}.`);
        }
        return marketplace;
    }

    equals(vo?: Marketplace): boolean {
        if (!vo) return false;
        return this._value === vo.value;
    }

    get value(): string {
        return this._value;
    }

}
