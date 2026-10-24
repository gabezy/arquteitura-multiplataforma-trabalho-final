import { Id } from "../../shared/domain/id";
import { Quantity } from "../../shared/domain/quantity.vo";
import { Price } from "../../shared/domain/price.vo";
import { ProductAnalysisStatus } from "./product-analysis-status.vo";
import { Sku } from "./sku.vo";
import { AnalysisAlreadyCompletedError, InsufficientStockError, InvalidProductError } from "./product.errors";
import { AggregateRoot } from "../../shared/domain/aggregate.root";
import { ProductCreated } from "./product-created.event";
import { ProductAnalysisApproved, ProductAnalysisRejected } from "./product-analysis.events";
import { ProductStockChanged } from "./product-stock-changed.event";
import { ProductPriceChanged } from "./product-price-changed.event";

export interface NewProductProps {
    sku: Sku;
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
}

export interface RestoreProductEntityProps {
    id: Id;
    sku: Sku;
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
    analysisStatus: ProductAnalysisStatus;
    version: number;
}

interface ProductEntityProps {
    id?: Id;
    sku: Sku;
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
    analysisStatus: ProductAnalysisStatus;
    version?: number;
}

export class ProductEntity extends AggregateRoot<Id> {

    private readonly _sku: Sku;
    private _name: string;
    private _description: string;
    private _price: Price;
    private _stock: Quantity;
    private _analysisStatus: ProductAnalysisStatus;
    private readonly _version: number;

    public static create(props: NewProductProps): ProductEntity {
        const product = new ProductEntity({
            ...props,
            analysisStatus: ProductAnalysisStatus.PENDING,
        });

        product.record(new ProductCreated(
            product.id.value,
            product.sku.value,
            product.name,
            product.description,
            product.price.value,
            product.stock.value
        ));

        return product;
    }

    public static restore(props: RestoreProductEntityProps): ProductEntity {
        return new ProductEntity({
            id: props.id,
            sku: props.sku,
            name: props.name,
            description: props.description,
            price: props.price,
            stock: props.stock,
            analysisStatus: props.analysisStatus,
            version: props.version,
        });
    }

    private constructor(props: ProductEntityProps) {
        super(props.id ?? new Id());
        this._sku = props.sku;
        this._name = props.name;
        this._description = props.description;
        this._price = props.price;
        this._stock = props.stock;
        this._analysisStatus = props.analysisStatus;
        this._version = props.version ?? 0;

        this.validate();
    }

    protected validate(): void {
        if (!this.name || this.name.trim().length === 0) {
            throw new InvalidProductError("Product name is required.");
        }
        if (!this.description || this.description.trim().length === 0) {
            throw new InvalidProductError("Product description is required.");
        }
    }

    get sku(): Sku {
        return this._sku;
    }

    get name(): string {
        return this._name;
    }

    get description(): string {
        return this._description;
    }

    get price(): Price {
        return this._price;
    }

    get stock(): Quantity {
        return this._stock;
    }

    get analysisStatus(): ProductAnalysisStatus {
        return this._analysisStatus;
    }

    // The version the product was read with. The repository uses it for optimistic locking.
    get version(): number {
        return this._version;
    }

    // Marketplaces only list approved products, so only those can be ordered.
    isAvailableForOrders(): boolean {
        return this._analysisStatus.equals(ProductAnalysisStatus.APPROVED);
    }

    addStock(quantity: Quantity): void {
        if (quantity.isZero()) {
            throw new InvalidProductError("Quantity to add must be greater than zero.");
        }
        this._stock = this._stock.add(quantity);
        this.recordStockChanged();
    }

    removeStock(quantity: Quantity): void {
        if (quantity.isZero()) {
            throw new InvalidProductError("Quantity to remove must be greater than zero.");
        }
        if (this._stock.isLessThan(quantity)) {
            throw new InsufficientStockError();
        }
        this._stock = this._stock.subtract(quantity);
        this.recordStockChanged();
    }

    private recordStockChanged(): void {
        this.record(new ProductStockChanged(this.id.value, this._sku.value, this._stock.value));
    }

    changePrice(price: Price): void {
        if (this._price.equals(price)) {
            return;
        }
        this._price = price;
        this.record(new ProductPriceChanged(this.id.value, this._sku.value, price.value));
    }

    approveAnalysis(): void {
        if (this.completeAnalysisAs(ProductAnalysisStatus.APPROVED)) {
            this.record(new ProductAnalysisApproved(this.id.value, this._sku.value));
        }
    }

    rejectAnalysis(): void {
        if (this.completeAnalysisAs(ProductAnalysisStatus.REJECTED)) {
            this.record(new ProductAnalysisRejected(this.id.value, this._sku.value));
        }
    }

    // A product is analysed once. Repeating the same result is a no-op, so a redelivered
    // message has no effect; reversing the result is a conflict.
    private completeAnalysisAs(result: ProductAnalysisStatus): boolean {
        if (this._analysisStatus.equals(result)) {
            return false;
        }
        if (!this._analysisStatus.equals(ProductAnalysisStatus.PENDING)) {
            throw new AnalysisAlreadyCompletedError(this._sku.value, this._analysisStatus.value);
        }
        this._analysisStatus = result;
        return true;
    }

}