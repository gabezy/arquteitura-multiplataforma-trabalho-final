import { ValidationError } from '../../shared/domain/domain.error';
import { MARKETPLACES, parseMarketplace, UnknownMarketplaceError } from './marketplace';

describe('parseMarketplace', () => {
  it.each(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE'])('accepts %s', value => {
    expect(parseMarketplace(value)).toBe(value);
  });

  it('knows exactly the three marketplaces of the contract', () => {
    expect([...MARKETPLACES]).toEqual(['AMAZON', 'MERCADO_LIVRE', 'SHOPEE']);
  });

  it.each(['amazon', 'EBAY', '', 'MERCADOLIVRE'])('rejects %p as a validation error', value => {
    expect(() => parseMarketplace(value)).toThrow(UnknownMarketplaceError);
    expect(() => parseMarketplace(value)).toThrow(ValidationError);
  });
});
