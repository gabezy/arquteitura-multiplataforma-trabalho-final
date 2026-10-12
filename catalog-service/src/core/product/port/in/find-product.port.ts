export interface FindProductPortInput {
    id: string;
}

export interface ProductOutput {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  analysisStatus: string;
}

export interface FindProductPort {
    find(input: FindProductPortInput): Promise<ProductOutput>;
}