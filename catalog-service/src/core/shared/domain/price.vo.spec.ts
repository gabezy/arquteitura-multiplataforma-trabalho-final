import { ValidationError } from "./domain.error";
import { Price } from "./price.vo";

describe("Price", () => {
  it.each([0, 9.9, 4500])("accepts %p", (value) => {
    expect(new Price(value).value).toBe(value);
  });

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY, "10" as unknown as number])("rejects %p", (value) => {
    expect(() => new Price(value)).toThrow(ValidationError);
  });
});
