import { Id } from "../shared/domain/id";
import { Price } from "../shared/domain/price.vo";
import { Quantity } from "../shared/domain/quantity.vo";
import { ProductEntity } from "./model/product.entity";
import { ProductNotFoundError } from "./model/product.errors";
import { AddProductPort, AddProductPortInput, AddProductPortOutput } from "./port/in/create-product.port";
import { FindProductPort, FindProductPortInput, ProductOutput } from "./port/in/find-product.port";
import { ImportProductsPort, ImportProductsPortInput } from "./port/in/import-products.port";
import { ProductRepositoryPort } from "./port/out/product.repository";

export class ProductFacade implements FindProductPort, ImportProductsPort, AddProductPort {

    constructor(private readonly productRepository: ProductRepositoryPort) {}

    async find(input: FindProductPortInput): Promise<ProductOutput> {
        const output = await this.productRepository.findById(new Id(input.id));
        
        if (!output) {
            throw new ProductNotFoundError(input.id);
        }

        return {
            id: output.id.value,
            name: output.name,
            description: output.description,
            price: output.price.value,
            stock: output.stock.value,
            analysisStatus: output.analysisStatus.value
        };
    }

    async import(input: ImportProductsPortInput): Promise<void> {
        var products: ProductEntity[] = input.items.map(item => {
            return ProductEntity.create({
                name: item.name,
                description: item.description,
                price: new Price(item.price),
                stock: new Quantity(item.stock),
            })
        });

        await this.productRepository.saveAll(products);
    }

    async add(input: AddProductPortInput): Promise<AddProductPortOutput> {
        var product = ProductEntity.create({
            name: input.name,
            description: input.description,
            price: new Price(input.price),
            stock: new Quantity(input.stock),
        });

        await this.productRepository.save(product);

        return {
            id: product.id.value
        };
    }

}