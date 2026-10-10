import { ValidationError } from "./domain.error";
import { Quantity } from "./quantity.vo";

describe("Quantity", () => {
  describe("constructor", () => {
    it.each([0, 1, 100])("accepts %p", (value) => {
      expect(new Quantity(value).value).toBe(value);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (value) => {
      expect(() => new Quantity(value)).toThrow("Quantity must be a non-negative integer.");
      expect(() => new Quantity(value)).toThrow(ValidationError);
    });
  });

  describe("isZero", () => {
    it("is true for zero", () => {
      expect(new Quantity(0).isZero()).toBe(true);
    });

    it("is false for a positive quantity", () => {
      expect(new Quantity(1).isZero()).toBe(false);
    });
  });

  describe("isLessThan", () => {
    it.each([
      [1, 2, true],
      [2, 2, false],
      [3, 2, false],
    ])("%p is less than %p: %p", (value, other, expected) => {
      expect(new Quantity(value).isLessThan(new Quantity(other))).toBe(expected);
    });
  });

  describe("add", () => {
    it("returns a new quantity with the sum", () => {
      const quantity = new Quantity(10);

      const result = quantity.add(new Quantity(5));

      expect(result.value).toBe(15);
      expect(quantity.value).toBe(10);
    });
  });

  describe("subtract", () => {
    it("returns a new quantity with the difference", () => {
      const quantity = new Quantity(10);

      const result = quantity.subtract(new Quantity(4));

      expect(result.value).toBe(6);
      expect(quantity.value).toBe(10);
    });

    it("rejects a result below zero", () => {
      expect(() => new Quantity(1).subtract(new Quantity(2))).toThrow("Quantity must be a non-negative integer.");
    });
  });

  describe("equals", () => {
    it("is equal to a quantity with the same value", () => {
      expect(new Quantity(5).equals(new Quantity(5))).toBe(true);
    });

    it("is not equal to a quantity with a different value", () => {
      expect(new Quantity(5).equals(new Quantity(6))).toBe(false);
    });

    it("is not equal to undefined", () => {
      expect(new Quantity(5).equals(undefined)).toBe(false);
    });
  });
});
