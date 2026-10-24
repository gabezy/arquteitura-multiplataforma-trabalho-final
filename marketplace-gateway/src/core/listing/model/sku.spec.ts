import { InvalidListingError } from './listing.errors';
import { normalizeSku } from './sku';

describe('normalizeSku', () => {
  it.each([
    ['NB-001', 'NB-001'],
    ['nb-001', 'NB-001'],
    ['  nb-001 ', 'NB-001'],
  ])('turns %p into %p', (value, expected) => {
    expect(normalizeSku(value)).toBe(expected);
  });

  it.each(['', '   '])('refuses %p as a validation error', value => {
    expect(() => normalizeSku(value)).toThrow(InvalidListingError);
    expect(() => normalizeSku(value)).toThrow('The SKU must not be empty.');
  });
});
