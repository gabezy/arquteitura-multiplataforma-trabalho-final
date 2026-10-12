import { ValidationError } from "../../shared/domain/domain.error";
import { Sku } from "./sku.vo";

describe("Sku", () => {
  it.each(["NB-001", "ABC", "A".repeat(50), "123-456"])("accepts %p", (value) => {
    expect(new Sku(value).value).toBe(value);
  });

  it("normalizes to trimmed upper case", () => {
    expect(new Sku("  nb-001 ").value).toBe("NB-001");
  });

  it.each(["", "   ", "AB", "A".repeat(51), "-NB001", "NB 001", "NB_001", "NB-ÇÃO", 123 as unknown as string])(
    "rejects %p",
    (value) => {
      expect(() => new Sku(value)).toThrow(ValidationError);
    },
  );

  it("is equal to a SKU with the same value regardless of case", () => {
    expect(new Sku("nb-001").equals(new Sku("NB-001"))).toBe(true);
  });

  it("is not equal to a different SKU", () => {
    expect(new Sku("NB-001").equals(new Sku("NB-002"))).toBe(false);
  });

  it("is not equal to undefined", () => {
    expect(new Sku("NB-001").equals(undefined)).toBe(false);
  });
});
