import { ValidationError } from '../../shared/domain/domain.error';

export const MARKETPLACES = ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const;

export type Marketplace = (typeof MARKETPLACES)[number];

export class UnknownMarketplaceError extends ValidationError {
    constructor(value: string) {
        super(`Unknown marketplace: ${value}.`);
    }
}

export function parseMarketplace(value: string): Marketplace {
    const marketplace = MARKETPLACES.find(candidate => candidate === value);

    if (!marketplace) {
        throw new UnknownMarketplaceError(value);
    }

    return marketplace;
}
