import { Knex } from 'knex';
import { parseMarketplace, Marketplace } from '../../core/marketplace/model/marketplace';
import { ListingStockRepositoryPort, UnsyncedListing, UnsyncedPriceListing } from '../../core/listing/port/out/listing-stock.repository';

interface UnsyncedRow {
    id: string;
    sku: string;
    marketplace: string;
    external_listing_id: string;
    stock: number;
}

interface UnsyncedPriceRow {
    id: string;
    sku: string;
    marketplace: string;
    external_listing_id: string;
    price: string | number;
}

// Each method is one UPDATE or SELECT, never a read followed by a write, so a stock event, a sync loop
// and a second instance of the gateway can work on the same listing without overwriting one another.
export class KnexListingStockRepository implements ListingStockRepositoryPort {

    constructor(private readonly knex: Knex) {}

    async recordStock(sku: string, stock: number, now: Date): Promise<number> {
        return this.knex('listings')
            .where({ sku, status: 'PUBLISHED' })
            .whereNot({ stock })
            .update({ stock, stock_synced: false, updated_at: now });
    }

    async recordPrice(sku: string, price: number, now: Date): Promise<number> {
        return this.knex('listings')
            .where({ sku, status: 'PUBLISHED' })
            .whereNot({ price })
            .update({ price, price_synced: false, updated_at: now });
    }

    async findUnsynced(marketplace: Marketplace, limit: number): Promise<UnsyncedListing[]> {
        const rows: UnsyncedRow[] = await this.knex('listings')
            .select('id', 'sku', 'marketplace', 'external_listing_id', 'stock')
            .where({ marketplace, status: 'PUBLISHED', stock_synced: false })
            .whereNotNull('external_listing_id')
            .orderBy([{ column: 'updated_at' }, { column: 'id' }])
            .limit(limit);

        return rows.map(row => ({
            id: row.id,
            sku: row.sku,
            marketplace: parseMarketplace(row.marketplace),
            externalListingId: row.external_listing_id,
            stock: row.stock,
        }));
    }

    async findPriceUnsynced(marketplace: Marketplace, limit: number): Promise<UnsyncedPriceListing[]> {
        const rows: UnsyncedPriceRow[] = await this.knex('listings')
            .select('id', 'sku', 'marketplace', 'external_listing_id', 'price')
            .where({ marketplace, status: 'PUBLISHED', price_synced: false })
            .whereNotNull('external_listing_id')
            .orderBy([{ column: 'updated_at' }, { column: 'id' }])
            .limit(limit);

        return rows.map(row => ({
            id: row.id,
            sku: row.sku,
            marketplace: parseMarketplace(row.marketplace),
            externalListingId: row.external_listing_id,
            price: Number(row.price),
        }));
    }

    async markSynced(id: string, stock: number): Promise<boolean> {
        const changed = await this.knex('listings')
            .where({ id, stock, stock_synced: false })
            .update({ stock_synced: true });

        return changed > 0;
    }

    async markPriceSynced(id: string, price: number): Promise<boolean> {
        const changed = await this.knex('listings')
            .where({ id, price, price_synced: false })
            .update({ price_synced: true });

        return changed > 0;
    }

}
