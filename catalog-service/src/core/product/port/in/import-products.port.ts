export interface ImportProductsPortInput {
    items: ImportProduct[];
}

export interface ImportProduct {
    sku: string;
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface ImportProductsPort {

    import(input: ImportProductsPortInput): Promise<void>;

}