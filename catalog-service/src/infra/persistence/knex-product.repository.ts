import { Knex } from "knex";
import { ProductEntity } from "../../core/product/model/product.entity";
import { DuplicateSkuError } from "../../core/product/model/product.errors";
import { Sku } from "../../core/product/model/sku.vo";
import { Id } from "../../core/shared/domain/id";
import { Price } from "../../core/shared/domain/price.vo";
import { Quantity } from "../../core/shared/domain/quantity.vo";
import { ProductAnalysisStatus } from "../../core/product/model/product-analysis-status.vo";
import { ProductRepositoryPort } from "../../core/product/port/out/product.repository";
import { KnexOutboxRepository } from "./knex-outbox.repository";

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: string | number; // pg devolve decimal como string, sqlite como number
  stock: number;
  analysis_status: string;
}

const TABLE_NAME = 'products';
const SKU_UNIQUE_INDEX = 'products_sku_unique';

export class KnexProductRepository implements ProductRepositoryPort {

    constructor(private readonly knex: Knex, private readonly outbox: KnexOutboxRepository) {}

    async save(product: ProductEntity): Promise<void> {
        await this.rejectingDuplicateSkus([product], () =>
            this.knex.transaction(async tx => {
                await tx(TABLE_NAME).insert(this.toRow(product))
                    .onConflict('id')
                    .merge();

                await this.outbox.append(tx, 'Product', product.pullDomainEvents());
            })
        );
    }

    async saveAll(products: ProductEntity[]): Promise<void> {
        if (products.length === 0) {
            return;
        }

        await this.rejectingDuplicateSkus(products, () =>
            this.knex.transaction(async tx => {
                const rows = products.map(product => this.toRow(product));
                await tx(TABLE_NAME).insert(rows)
                    .onConflict('id')
                    .merge();

                const events = products.flatMap(product => product.pullDomainEvents());
                await this.outbox.append(tx, 'Product', events);
            })
        );
    }

    async findBySku(sku: Sku): Promise<ProductEntity | null> {
        const row = await this.knex(TABLE_NAME).where({ sku: sku.value }).first();

        if (!row) {
            return null;
        }

        return this.toEntity(row);
    }

    async findExistingSkus(skus: Sku[]): Promise<Sku[]> {
        if (skus.length === 0) {
            return [];
        }

        const rows: Pick<ProductRow, 'sku'>[] = await this.knex(TABLE_NAME)
            .select('sku')
            .whereIn('sku', skus.map(sku => sku.value));

        return rows.map(row => new Sku(row.sku));
    }

    // The facade checks SKUs before saving, but two concurrent requests can both pass
    // that check. The unique index is the final guard, and its violation becomes a domain error.
    private async rejectingDuplicateSkus(products: ProductEntity[], write: () => Promise<unknown>): Promise<void> {
        try {
            await write();
        } catch (err) {
            if (!isSkuUniqueViolation(err)) {
                throw err;
            }
            const skus = products.map(product => product.sku);
            const taken = await this.findExistingSkus(skus);
            throw new DuplicateSkuError((taken.length > 0 ? taken : skus).map(sku => sku.value));
        }
    }


    private toRow(product: ProductEntity): ProductRow {
        return {
            id: product.id.value,
            sku: product.sku.value,
            name: product.name,
            description: product.description,
            price: String(product.price.value),
            stock: product.stock.value,
            analysis_status: product.analysisStatus.value
        };
    }

    private toEntity(row: ProductRow): ProductEntity {
        return ProductEntity.restore({
            id: new Id(row.id),
            sku: new Sku(row.sku),
            name: row.name,
            description: row.description,
            price: new Price(Number(row.price)),
            stock: new Quantity(row.stock),
            analysisStatus: this.toAnalysisStatus(row.analysis_status)
        })
    }

    private toAnalysisStatus(value: string): ProductAnalysisStatus {
        switch (value) {
            case 'PENDING':
                return ProductAnalysisStatus.PENDING;
            case 'APPROVED':
                return ProductAnalysisStatus.APPROVED;
            case 'REJECTED':
                return ProductAnalysisStatus.REJECTED;
            default:
                throw new Error(`Invalid analysis status: ${value}`);
        }
    }

}

// Postgres reports the violated index by name; SQLite (used in tests) only by column.
function isSkuUniqueViolation(err: unknown): boolean {
    const { code, constraint, message } = (err ?? {}) as { code?: string; constraint?: string; message?: string };
    if (code === '23505') {
        return constraint === SKU_UNIQUE_INDEX;
    }
    return code === 'SQLITE_CONSTRAINT_UNIQUE' && (message ?? '').includes(`${TABLE_NAME}.sku`);
}
