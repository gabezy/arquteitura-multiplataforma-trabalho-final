import { MarketplaceRegistry } from '../marketplace/marketplace.registry';
import { Marketplace } from '../marketplace/model/marketplace';
import { MarketplaceError } from '../marketplace/model/marketplace.errors';
import { Listing } from './model/listing.entity';
import { ListingNotFoundError } from './model/listing.errors';
import { normalizeSku } from './model/sku';
import { FindListingsPort, ListingsPage, ListingsQuery, ListingView } from './port/in/find-listings.port';
import { PublishApprovedProductInput, PublishApprovedProductPort } from './port/in/publish-approved-product.port';
import { ListingReadRepositoryPort } from './port/out/listing-read.repository';
import { ListingRepositoryPort } from './port/out/listing.repository';
import { CatalogProduct, ProductCatalogPort } from './port/out/product-catalog.port';

export class ListingFacade implements PublishApprovedProductPort, FindListingsPort {

    constructor(
        private readonly marketplaces: MarketplaceRegistry,
        private readonly listings: ListingRepositoryPort,
        private readonly reader: ListingReadRepositoryPort,
        private readonly catalog: ProductCatalogPort,
        private readonly now: () => Date = () => new Date(),
    ) {}

    // Lists the product at every marketplace that does not have it published yet, all at once. A marketplace that
    // fails ends with a FAILED listing and an event, and never stops the others.
    async publish({ productId, sku }: PublishApprovedProductInput): Promise<void> {
        const normalizedSku = normalizeSku(sku);
        const existing = await this.listings.findBySku(normalizedSku);
        const missing = this.marketplaces.marketplaces().filter(marketplace => !this.isPublished(existing, marketplace));

        if (missing.length === 0) {
            return;
        }

        // The product is read before anything is saved, so a catalog that is down leaves no listing behind.
        const product = await this.catalog.findBySku(normalizedSku);

        const outcomes = await Promise.allSettled(
            missing.map(marketplace => this.publishAt(marketplace, productId, product, existing)),
        );

        const unexpected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (unexpected) {
            throw unexpected.reason;
        }
    }

    async find(query: ListingsQuery): Promise<ListingsPage> {
        const normalized = query.sku === undefined ? query : { ...query, sku: normalizeSku(query.sku) };

        return { listings: await this.reader.find(normalized), limit: query.limit, offset: query.offset };
    }

    async findById(id: string): Promise<ListingView> {
        const listing = await this.reader.findById(id);

        if (!listing) {
            throw new ListingNotFoundError(id);
        }

        return listing;
    }

    private isPublished(existing: Listing[], marketplace: Marketplace): boolean {
        return existing.some(listing => listing.marketplace === marketplace && listing.status === 'PUBLISHED');
    }

    private async publishAt(
        marketplace: Marketplace,
        productId: string,
        product: CatalogProduct,
        existing: Listing[],
    ): Promise<void> {
        const listing = this.listingToTry(marketplace, productId, product, existing);

        // PENDING is saved first: while the marketplace answers, the API shows that the listing is on its way.
        await this.listings.save(listing);

        try {
            const { externalListingId } = await this.marketplaces.get(marketplace).publishListing({
                listingId: listing.id.value,
                sku: listing.sku,
                name: product.name,
                description: product.description,
                price: product.price,
                stock: product.stock,
            });
            listing.markPublished(externalListingId, this.now());
        } catch (err) {
            if (!(err instanceof MarketplaceError)) {
                throw err;
            }
            listing.markFailed(err.message, err.attempts, this.now());
        }

        await this.listings.save(listing);
    }

    private listingToTry(marketplace: Marketplace, productId: string, product: CatalogProduct, existing: Listing[]): Listing {
        const previous = existing.find(listing => listing.marketplace === marketplace);

        if (previous) {
            previous.restart(product.price, product.stock, this.now());
            return previous;
        }

        return Listing.pending({ productId, sku: product.sku, marketplace, price: product.price, stock: product.stock }, this.now());
    }

}
