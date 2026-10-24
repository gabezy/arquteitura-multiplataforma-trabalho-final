import { Knex } from 'knex';
import { parseMarketplace } from '../../core/marketplace/model/marketplace';
import { Listing } from '../../core/listing/model/listing.entity';
import { parseListingStatus } from '../../core/listing/model/listing-status';
import { ListingRepositoryPort } from '../../core/listing/port/out/listing.repository';
import { Id } from '../../core/shared/domain/id';
import { KnexOutboxRepository } from './knex-outbox.repository';

interface ListingRow {
    id: string;
    product_id: string;
    sku: string;
    marketplace: string;
    status: string;
    external_listing_id: string | null;
    price: string;
    stock: number;
    failure_reason: string | null;
    attempts: number;
    updated_at: Date;
}

export class KnexListingRepository implements ListingRepositoryPort {

    constructor(private readonly knex: Knex, private readonly outbox: KnexOutboxRepository) {}

    async findBySku(sku: string): Promise<Listing[]> {
        const rows: ListingRow[] = await this.knex('listings').where({ sku }).orderBy('marketplace');

        return rows.map(row => Listing.restore({
            id: new Id(row.id),
            productId: row.product_id,
            sku: row.sku,
            marketplace: parseMarketplace(row.marketplace),
            status: parseListingStatus(row.status),
            externalListingId: row.external_listing_id,
            price: Number(row.price),
            stock: row.stock,
            failureReason: row.failure_reason,
            attempts: row.attempts,
            updatedAt: row.updated_at,
        }));
    }

    async save(listing: Listing): Promise<void> {
        const state = listing.toState();

        await this.knex.transaction(async tx => {
            await tx('listings')
                .insert({
                    id: state.id.value,
                    product_id: state.productId,
                    sku: state.sku,
                    marketplace: state.marketplace,
                    status: state.status,
                    external_listing_id: state.externalListingId,
                    price: state.price,
                    stock: state.stock,
                    failure_reason: state.failureReason,
                    attempts: state.attempts,
                    updated_at: state.updatedAt,
                })
                .onConflict('id')
                .merge();

            await this.outbox.append(tx, 'Listing', listing.pullDomainEvents());
        });
    }

}
