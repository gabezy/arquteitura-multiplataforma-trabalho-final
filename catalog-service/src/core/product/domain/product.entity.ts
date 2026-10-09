import { Entity } from "../../shared/domain/entity";
import { Id } from "../../shared/domain/id";
import { Quantity } from "../../shared/domain/quantity.vo";
import { Price } from "../../shared/domain/price.vo";
import { ProductAnalysisStatus } from "./product-analysis-status.vo";

export interface NewProductProps {
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
}

export interface RestoreProductEntityProps {
    id: Id;
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
    analysisStatus: ProductAnalysisStatus;
}

interface ProductEntityProps {
    id?: Id;
    name: string;
    description: string;
    price: Price;
    stock: Quantity;
    analysisStatus: ProductAnalysisStatus;
}

export class ProductEntity extends Entity<Id> {

    private _name: string;
    private _description: string;
    private _price: Price;
    private _stock: Quantity;
    private _analysisStatus: ProductAnalysisStatus;

    public static create(props: NewProductProps): ProductEntity {
        const data: ProductEntityProps = {
            name: props.name,
            description: props.description,
            price: props.price,
            stock: props.stock,
            analysisStatus: ProductAnalysisStatus.PENDING,
        };

        return new ProductEntity(data);
    }

    public static restore(props: RestoreProductEntityProps): ProductEntity {
        return new ProductEntity({
            id: props.id,
            name: props.name,
            description: props.description,
            price: props.price,
            stock: props.stock,
            analysisStatus: props.analysisStatus,
        });
    }

    private constructor(props: ProductEntityProps) {
        super(props.id ?? new Id());
        this._name = props.name;
        this._description = props.description;
        this._price = props.price;
        this._stock = props.stock;
        this._analysisStatus = props.analysisStatus;

        this.validate();
    }

    protected validate(): void {
        if (!this.name || this.name.trim().length === 0) {
            throw new Error("Product name is required.");
        }
        if (!this.description || this.description.trim().length === 0) {
            throw new Error("Product description is required.");
        }
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

    addStock(quantity: Quantity): void {
        if (quantity.isZero()) {
            throw new Error("Quantity to add must be greater than zero.");
        }
        this._stock = this._stock.add(quantity);
    }

    removeStock(quantity: Quantity): void {
        if (quantity.isZero()) {
            throw new Error("Quantity to remove must be greater than zero.");
        }
        if (this._stock.isLessThan(quantity)) {
            throw new Error("Insufficient stock to remove the specified quantity.");
        }
        this._stock = this._stock.subtract(quantity);
    }

    approveAnalysis(): void {
        this._analysisStatus = ProductAnalysisStatus.APPROVED;
    }

    rejectAnalysis(): void {
        this._analysisStatus = ProductAnalysisStatus.REJECTED;
    }

}