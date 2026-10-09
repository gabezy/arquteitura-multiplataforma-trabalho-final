import { ValueObject } from "../../shared/domain/value.object";

export class ProductAnalysisStatus implements ValueObject<ProductAnalysisStatus, string> {

    private constructor(private readonly _value: string) {}


    static readonly PENDING = new ProductAnalysisStatus("PENDING");
    static readonly APPROVED = new ProductAnalysisStatus("APPROVED");
    static readonly REJECTED = new ProductAnalysisStatus("REJECTED");

    equals(vo?: ProductAnalysisStatus | undefined): boolean {
        if (!vo) return false;
        return this._value === vo.value;
    }
    get value(): string {
        return this._value;
    }

}