import { ValidationError } from '../../shared/domain/domain.error';

export const LISTING_STATUSES = ['PENDING', 'PUBLISHED', 'FAILED'] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export class UnknownListingStatusError extends ValidationError {
    constructor(value: string) {
        super(`Unknown listing status: ${value}.`);
    }
}

export function parseListingStatus(value: string): ListingStatus {
    const status = LISTING_STATUSES.find(candidate => candidate === value);

    if (!status) {
        throw new UnknownListingStatusError(value);
    }

    return status;
}
