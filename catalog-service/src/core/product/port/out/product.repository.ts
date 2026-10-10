import { Id } from "../../../shared/domain/id";
import { ProductEntity } from "../../domain/product.entity";

export interface ProductRepositoryPort {
    save(product: ProductEntity): Promise<void>;
    saveAll(products: ProductEntity[]): Promise<void>;
    findById(id: Id): Promise<ProductEntity>;
}