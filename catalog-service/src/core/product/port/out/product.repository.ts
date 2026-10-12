import { Id } from "../../../shared/domain/id";
import { ProductEntity } from "../../model/product.entity";
import { Sku } from "../../model/sku.vo";

export interface ProductRepositoryPort {
    // save and saveAll reject with DuplicateSkuError when another product already has the SKU.
    save(product: ProductEntity): Promise<void>;
    saveAll(products: ProductEntity[]): Promise<void>;
    findById(id: Id): Promise<ProductEntity | null>;
    findExistingSkus(skus: Sku[]): Promise<Sku[]>;
}