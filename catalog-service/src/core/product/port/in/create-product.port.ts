export interface AddProductPortInput {
    sku: string;
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface AddProductPortOutput {
    id: string;
}

export interface AddProductPort {

    add(input: AddProductPortInput): Promise<AddProductPortOutput>;

}