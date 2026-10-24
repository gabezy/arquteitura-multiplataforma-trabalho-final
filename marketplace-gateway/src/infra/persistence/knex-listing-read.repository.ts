import { Knex } from 'knex';
import { parseMarketplace } from '../../core/marketplace/model/marketplace';
import { parseListingStatus } from '../../core/listing/model/listing-status';
import { ListingsQuery, ListingView } from '../../core/listing/port/in/find-listings.port';
import { ListingReadRepositoryPort } from '../../core/listing/port/out/listing-read.repository';

interface ListingViewRow {
    id: string;
    sku: string;
    marketplace: string;
    external_listing_id: string | null;
    status: string;
    price: string;
    stock: number;
    failure_reason: string | null;
    updated_at: Date;
}

const COLUMNS = ['id', 'sku', 'marketplace', 'external_listing_id', 'status', 'price', 'stock', 'failure_reason', 'updated_at'];

export class KnexListingReadRepository implements ListingReadRepositoryPort {

    constructor(private readonly knex: Knex) {}

    async find({ sku, marketplace, status, limit, offset }: ListingsQuery): Promise<ListingView[]> {
        const filters = { sku, marketplace, status };
        const present = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));

        const rows: ListingViewRow[] = await this.knex('listings')
            .select(COLUMNS)
            .where(present)
            .orderBy([{ column: 'sku' }, { column: 'marketplace' }])
            .limit(limit)
            .offset(offset);

        return rows.map(toView);
    }

    async findById(id: string): Promise<ListingView | null> {
        const row: ListingViewRow | undefined = await this.knex('listings').select(COLUMNS).where({ id }).first();

        return row ? toView(row) : null;
    }

}

function toView(row: ListingViewRow): ListingView {
    return {
        id: row.id,
        sku: row.sku,
        marketplace: parseMarketplace(row.marketplace),
        externalListingId: row.external_listing_id,
        status: parseListingStatus(row.status),
        price: Number(row.price),
        stock: row.stock,
        failureReason: row.failure_reason,
        updatedAt: row.updated_at,
    };
}
