import { Marketplace } from '../../marketplace/model/marketplace';
import { AggregateRoot } from '../../shared/domain/aggregate.root';
import { Id } from '../../shared/domain/id';
import { ListingFailed, ListingPublished } from './listing.events';
import { InvalidListingError, InvalidListingTransitionError } from './listing.errors';
import { ListingStatus } from './listing-status';
import { normalizeSku } from './sku';

export interface ListingState {
    id: Id;
    productId: string;
    sku: string;
    marketplace: Marketplace;
    status: ListingStatus;
    externalListingId: string | null;
    price: number;
    stock: number;
    failureReason: string | null;
    attempts: number;
    updatedAt: Date;
}

export interface NewListing {
    productId: string;
    sku: string;
    marketplace: Marketplace;
    price: number;
    stock: number;
}

// The listing of a product at one marketplace. It is born PENDING, while the gateway waits for the
// marketplace, and ends PUBLISHED or FAILED. A FAILED listing can start again; a PUBLISHED one cannot.
export class Listing extends AggregateRoot<Id> {

    private constructor(private state: ListingState) {
        super(state.id);
        this.validate();
    }

    static pending(input: NewListing, now: Date): Listing {
        return new Listing({
            id: new Id(),
            productId: input.productId,
            sku: normalizeSku(input.sku),
            marketplace: input.marketplace,
            status: 'PENDING',
            externalListingId: null,
            price: input.price,
            stock: input.stock,
            failureReason: null,
            attempts: 0,
            updatedAt: now,
        });
    }

    static restore(state: ListingState): Listing {
        return new Listing({ ...state });
    }

    get productId(): string {
        return this.state.productId;
    }

    get sku(): string {
        return this.state.sku;
    }

    get marketplace(): Marketplace {
        return this.state.marketplace;
    }

    get status(): ListingStatus {
        return this.state.status;
    }

    get externalListingId(): string | null {
        return this.state.externalListingId;
    }

    get price(): number {
        return this.state.price;
    }

    get stock(): number {
        return this.state.stock;
    }

    get failureReason(): string | null {
        return this.state.failureReason;
    }

    get attempts(): number {
        return this.state.attempts;
    }

    get updatedAt(): Date {
        return this.state.updatedAt;
    }

    toState(): ListingState {
        return { ...this.state };
    }

    // Tries again a listing that did not make it, with the data of the product as it is now.
    restart(price: number, stock: number, now: Date): void {
        if (this.state.status === 'PUBLISHED') {
            throw new InvalidListingTransitionError(`Listing ${this.id.value} is already published.`);
        }

        this.state = { ...this.state, status: 'PENDING', price, stock, failureReason: null, attempts: 0, updatedAt: now };
        this.validate();
    }

    markPublished(externalListingId: string, now: Date): void {
        this.requirePending('published');

        if (externalListingId.trim() === '') {
            throw new InvalidListingError('A published listing needs the id the marketplace gave it.');
        }

        this.state = { ...this.state, status: 'PUBLISHED', externalListingId, failureReason: null, updatedAt: now };
        this.record(new ListingPublished(this.productId, this.sku, this.marketplace, externalListingId, now));
    }

    markFailed(reason: string, attempts: number, now: Date): void {
        this.requirePending('failed');

        this.state = { ...this.state, status: 'FAILED', failureReason: reason, attempts, updatedAt: now };
        this.validate();
        this.record(new ListingFailed(this.productId, this.sku, this.marketplace, reason, attempts));
    }

    private requirePending(target: string): void {
        if (this.state.status !== 'PENDING') {
            throw new InvalidListingTransitionError(`Listing ${this.id.value} is ${this.state.status}, so it cannot be ${target}.`);
        }
    }

    protected validate(): void {
        const { price, stock, attempts } = this.state;

        if (!Number.isFinite(price) || price < 0) {
            throw new InvalidListingError('The price of a listing must not be negative.');
        }
        if (!Number.isInteger(stock) || stock < 0) {
            throw new InvalidListingError('The stock of a listing must be an integer that is not negative.');
        }
        if (!Number.isInteger(attempts) || attempts < 0) {
            throw new InvalidListingError('The attempts of a listing must be an integer that is not negative.');
        }
    }

}
