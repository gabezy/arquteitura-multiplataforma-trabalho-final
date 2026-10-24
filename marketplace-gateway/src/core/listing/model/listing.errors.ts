import { ConflictError, NotFoundError, ValidationError } from '../../shared/domain/domain.error';

export class InvalidListingError extends ValidationError {}

export class ListingNotFoundError extends NotFoundError {
    constructor(id: string) {
        super(`Listing ${id} not found.`);
    }
}

// Publishing a listing that is not waiting for the marketplace's answer, or restarting one that is live.
export class InvalidListingTransitionError extends ConflictError {}

export class ProductNotFoundError extends NotFoundError {
    constructor(sku: string) {
        super(`Product ${sku} not found in the catalog.`);
    }
}

// The catalog still (or no longer) holds the product in a state that cannot be sold.
export class ProductNotApprovedError extends ConflictError {
    constructor(sku: string, analysisStatus: string) {
        super(`Product ${sku} is not approved: its analysis status is ${analysisStatus}.`);
    }
}

// The catalog refused the request for the product, and asking again will not change its mind.
export class ProductRequestRefusedError extends ValidationError {
    constructor(sku: string, status: number) {
        super(`The catalog refused the request for product ${sku}: HTTP ${status}.`);
    }
}
