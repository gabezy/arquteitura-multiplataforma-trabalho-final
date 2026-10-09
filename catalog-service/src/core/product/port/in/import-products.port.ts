export interface ImportProductsPortInput {
    items: ImportProduct[];
}

export interface ImportProduct {
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface ImportProductsPort {

    execute(input: ImportProductsPortInput): Promise<void>;

}