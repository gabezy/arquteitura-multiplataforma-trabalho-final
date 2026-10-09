import { Id } from "../../../shared/domain/id";
import { ProductEntity } from "../../domain/product.entity";

export interface ProductRepository {
    save(product: ProductEntity): Promise<void>;
    saveAll(products: ProductEntity[]): Promise<void>;
    findById(Id: Id): Promise<ProductEntity | null>;
}