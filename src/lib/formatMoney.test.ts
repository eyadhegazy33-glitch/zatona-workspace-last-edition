import { describe, expect, it } from "vitest";
import { formatMoney } from "./formatMoney";

describe("formatMoney", () => {
  it("formats fake monetary amounts as a currency", () => {
    expect(formatMoney(1234.5, "USD", "en-US")).toContain("$");
    expect(formatMoney(1234.5, "EGP", "ar-EG")).toMatch(/ج\.م|EGP/);
  });

  it("does not turn non-finite values into plausible money", () => {
    expect(() => formatMoney(Number.NaN, "USD", "en-US")).toThrow(RangeError);
  });
});
