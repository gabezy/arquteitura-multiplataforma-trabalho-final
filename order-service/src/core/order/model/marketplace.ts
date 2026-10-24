export const MARKETPLACES = ['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'] as const;

export type Marketplace = (typeof MARKETPLACES)[number];
