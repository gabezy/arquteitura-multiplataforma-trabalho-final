export interface AddProductPortInput {
    name: string;
    description: string;
    price: number;
    stock: number;
}

export interface AddProductPortOutput {
    id: string;
}

export interface AddProductPort {

    execute(input: AddProductPortInput): Promise<AddProductPortOutput>;

}