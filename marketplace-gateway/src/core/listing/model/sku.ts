import { InvalidListingError } from './listing.errors';

// The catalog keeps every SKU trimmed and in capitals, and treats nb-001 and NB-001 as the same product.
export function normalizeSku(value: string): string {
    const sku = value.trim().toUpperCase();

    if (sku === '') {
        throw new InvalidListingError('The SKU must not be empty.');
    }

    return sku;
}
