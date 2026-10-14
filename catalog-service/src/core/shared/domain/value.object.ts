export interface ValueObject<T, O> {

    equals(vo?: T): boolean;

    get value(): O;

}