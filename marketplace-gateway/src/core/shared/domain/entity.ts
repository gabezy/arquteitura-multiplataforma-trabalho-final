export abstract class Entity<TId extends { equals(other: TId): boolean }> {
  protected constructor(protected readonly _id: TId) {}

  get id(): TId {
    return this._id;
  }

  equals(other?: Entity<TId>): boolean {
    if (!other || other.constructor !== this.constructor) return false;
    return this._id.equals(other._id);
  }

  protected abstract validate(): void ;

}