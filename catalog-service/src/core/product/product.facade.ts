import { Price } from "../shared/domain/price.vo";
import { Quantity } from "../shared/domain/quantity.vo";
import { ProductEntity } from "./model/product.entity";
import { DuplicateSkuError, ProductNotFoundError } from "./model/product.errors";
import { Sku } from "./model/sku.vo";
import { AddProductPort, AddProductPortInput, AddProductPortOutput } from "./port/in/create-product.port";
import { FindProductPort, FindProductPortInput, ProductOutput } from "./port/in/find-product.port";
import { ImportProduct, ImportProductsPort, ImportProductsPortInput } from "./port/in/import-products.port";
import { ProductRepositoryPort } from "./port/out/product.repository";

export class ProductFacade implements FindProductPort, ImportProductsPort, AddProductPort {

    constructor(private readonly productRepository: ProductRepositoryPort) {}

    async find(input: FindProductPortInput): Promise<ProductOutput> {
        const output = await this.productRepository.findBySku(new Sku(input.sku));

        if (!output) {
            throw new ProductNotFoundError(input.sku);
        }

        return {
            id: output.id.value,
            sku: output.sku.value,
            name: output.name,
            description: output.description,
            price: output.price.value,
            stock: output.stock.value,
            analysisStatus: output.analysisStatus.value
        };
    }

    async import(input: ImportProductsPortInput): Promise<void> {
        const products = input.items.map(item => this.newProduct(item));

        this.ensureNoRepeatedSkus(products);
        await this.ensureSkusAreAvailable(products);

        await this.productRepository.saveAll(products);
    }

    async add(input: AddProductPortInput): Promise<AddProductPortOutput> {
        const product = this.newProduct(input);

        await this.ensureSkusAreAvailable([product]);

        await this.productRepository.save(product);

        return {
            id: product.id.value,
            sku: product.sku.value,
        };
    }

    private newProduct(input: AddProductPortInput | ImportProduct): ProductEntity {
        return ProductEntity.create({
            sku: new Sku(input.sku),
            name: input.name,
            description: input.description,
            price: new Price(input.price),
            stock: new Quantity(input.stock),
        });
    }

    private ensureNoRepeatedSkus(products: ProductEntity[]): void {
        const seen = new Set<string>();
        const repeated = new Set<string>();

        for (const { sku } of products) {
            if (seen.has(sku.value)) {
                repeated.add(sku.value);
            }
            seen.add(sku.value);
        }

        if (repeated.size > 0) {
            throw new DuplicateSkuError([...repeated]);
        }
    }

    private async ensureSkusAreAvailable(products: ProductEntity[]): Promise<void> {
        const taken = await this.productRepository.findExistingSkus(products.map(product => product.sku));

        if (taken.length > 0) {
            throw new DuplicateSkuError(taken.map(sku => sku.value));
        }
    }

}
