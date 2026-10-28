import { ProductEntity } from "../../model/product.entity";
import { Sku } from "../../model/sku.vo";

export interface ProductRepositoryPort {
    // save and saveAll reject with DuplicateSkuError when another product already has the SKU.
    // For a product that already exists they keep the stored stock: stock only changes
    // through StockReservationRepositoryPort, which checks the product version.
    save(product: ProductEntity): Promise<void>;
    saveAll(products: ProductEntity[]): Promise<void>;
    findBySku(sku: Sku): Promise<ProductEntity | null>;
    findBySkus(skus: Sku[]): Promise<ProductEntity[]>;
    findExistingSkus(skus: Sku[]): Promise<Sku[]>;
}