export interface CreateProductPortInput {
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface CreateProductPortOutput {
    id: string;
}

export interface CreateProductPort {

    execute(input: CreateProductPortInput): Promise<CreateProductPortOutput>;

}