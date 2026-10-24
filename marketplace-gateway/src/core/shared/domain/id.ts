import { ValueObject } from "./value.object";

export class Id implements ValueObject<Id, string> {

    private _id: string;

    constructor(id?: string) {
        this._id = id ?? crypto.randomUUID();
    }

    public get value() {
        return this._id;
    }

    equals(vo?: Id): boolean {
        if (vo === null || vo === undefined) {
            return false;
        }

        if (!(vo instanceof Id)) {
            return false;
        }

        return this.value === vo.value;
    }

}