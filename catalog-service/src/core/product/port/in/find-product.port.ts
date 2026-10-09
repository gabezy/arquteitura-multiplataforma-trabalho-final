export interface FindProductPortInput {
    id: string;
}

export interface ProductOutput {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  analysisStatus: string;
}

export interface FindProductPort {
    execute(input: FindProductPortInput): Promise<ProductOutput>;
}