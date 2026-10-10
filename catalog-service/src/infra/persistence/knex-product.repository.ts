import { Knex } from "knex";
import { ProductEntity } from "../../core/product/model/product.entity";
import { Id } from "../../core/shared/domain/id";
import { Price } from "../../core/shared/domain/price.vo";
import { Quantity } from "../../core/shared/domain/quantity.vo";
import { ProductAnalysisStatus } from "../../core/product/model/product-analysis-status.vo";
import { ProductRepositoryPort } from "../../core/product/port/out/product.repository";

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price: string | number; // pg devolve decimal como string, sqlite como number
  stock: number;
  analysis_status: string;
}

const TABLE_NAME = 'products';

export class KnexProductRepository implements ProductRepositoryPort {

    constructor(private readonly knex: Knex) {}

    async save(product: ProductEntity): Promise<void> {
        await this.knex(TABLE_NAME).insert(this.toRow(product))
            .onConflict('id')
            .merge();
    }

    async saveAll(products: ProductEntity[]): Promise<void> {
        if (products.length === 0) {
            return;
        }

        await this.knex.transaction(async tx => {
            const rows = products.map(product => this.toRow(product));
            await tx(TABLE_NAME).insert(rows)
                .onConflict('id')
                .merge();
        })
    }

    async findById(id: Id): Promise<ProductEntity | null> {
        const row = await this.knex(TABLE_NAME).where({ id: id.value }).first();

        if (!row) {
            return null;
        }

        return this.toEntity(row);
    }


    private toRow(product: ProductEntity): ProductRow {
        return {
            id: product.id.value,
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