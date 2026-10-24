import { ValidationError } from '../shared/domain/domain.error';
import { Marketplace } from './model/marketplace';
import { MarketplacePort } from './port/out/marketplace.port';

export class UnsupportedMarketplaceError extends ValidationError {
    constructor(marketplace: Marketplace) {
        super(`No adapter configured for ${marketplace}.`);
    }
}

// The marketplace adapters by marketplace: the facades pick the one they need by name.
export class MarketplaceRegistry {

    private readonly byMarketplace = new Map<Marketplace, MarketplacePort>();

    constructor(ports: MarketplacePort[]) {
        for (const port of ports) {
            this.byMarketplace.set(port.marketplace, port);
        }
    }

    get(marketplace: Marketplace): MarketplacePort {
        const port = this.byMarketplace.get(marketplace);

        if (!port) {
            throw new UnsupportedMarketplaceError(marketplace);
        }

        return port;
    }

    marketplaces(): Marketplace[] {
        return [...this.byMarketplace.keys()];
    }

}
