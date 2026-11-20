import { describe, expect, it } from "vitest";
import { codFeeBpsFor, codFeeCents } from "@sakura/contracts";

describe("codFeeCents", () => {
  it("charges 1% inside Dhaka city and 2% in the suburbs and outside", () => {
    expect(codFeeCents("ISD", 100_000)).toBe(1_000); // ৳1,000 → ৳10
    expect(codFeeCents("SUBURB", 100_000)).toBe(2_000);
    expect(codFeeCents("OSD", 100_000)).toBe(2_000);
  });

  it("rounds up to the whole taka", () => {
    expect(codFeeCents("ISD", 54_000)).toBe(600); // ৳5.40 → ৳6
    expect(codFeeCents("OSD", 47_000)).toBe(1_000); // ৳9.40 → ৳10
    expect(codFeeCents("ISD", 100)).toBe(100); // never zero on a real order
  });

  it("is zero on an empty or free order", () => {
    expect(codFeeCents("OSD", 0)).toBe(0);
  });

  it("uses the higher rate before a zone is known", () => {
    expect(codFeeCents(null, 100_000)).toBe(2_000);
    expect(codFeeBpsFor(undefined)).toBe(200);
    expect(codFeeBpsFor("ISD")).toBe(100);
  });
});

describe("codFeeCents with saved rates", () => {
  it("uses staff-set rates, Dhaka for ISD and outside for the rest", () => {
    const rates = { dhakaBps: 150, outsideBps: 250 };
    expect(codFeeCents("ISD", 100_000, rates)).toBe(1_500);
    expect(codFeeCents("SUBURB", 100_000, rates)).toBe(2_500);
    expect(codFeeCents("OSD", 47_800, rates)).toBe(1_200); // ৳11.95 → ৳12
  });

  it("charges nothing at a zero rate", () => {
    expect(codFeeCents("OSD", 100_000, { dhakaBps: 0, outsideBps: 0 })).toBe(0);
  });
});
