// Categories of domain errors. Adapters map a category, never a concrete
// class, so a new error only has to extend the right category.
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// A value or invariant is invalid (e.g. negative price, empty name).
export class ValidationError extends DomainError {}

// The requested aggregate does not exist.
export class NotFoundError extends DomainError {}

// The operation is valid but conflicts with the current state (e.g. not enough stock).
export class ConflictError extends DomainError {}
