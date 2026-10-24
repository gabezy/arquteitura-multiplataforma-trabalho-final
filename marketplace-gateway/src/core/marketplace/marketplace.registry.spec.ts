import { MarketplaceRegistry, UnsupportedMarketplaceError } from './marketplace.registry';
import { Marketplace } from './model/marketplace';
import { MarketplacePort } from './port/out/marketplace.port';

const portOf = (marketplace: Marketplace): MarketplacePort => ({
  marketplace,
  publishListing: jest.fn(),
  updateStock: jest.fn(),
  fetchNewOrders: jest.fn(),
  cancelOrder: jest.fn(),
});

describe('MarketplaceRegistry', () => {
  const amazon = portOf('AMAZON');
  const shopee = portOf('SHOPEE');
  const registry = new MarketplaceRegistry([amazon, shopee]);

  it('gives the adapter of the marketplace asked for', () => {
    expect(registry.get('AMAZON')).toBe(amazon);
    expect(registry.get('SHOPEE')).toBe(shopee);
  });

  it('lists the marketplaces it has an adapter for', () => {
    expect(registry.marketplaces()).toEqual(['AMAZON', 'SHOPEE']);
  });

  it('refuses a marketplace without an adapter', () => {
    expect(() => registry.get('MERCADO_LIVRE')).toThrow(UnsupportedMarketplaceError);
    expect(() => registry.get('MERCADO_LIVRE')).toThrow('No adapter configured for MERCADO_LIVRE.');
  });
});
