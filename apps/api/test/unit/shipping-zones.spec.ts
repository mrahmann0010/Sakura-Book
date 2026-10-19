import {
  bdDivisions,
  DEFAULT_BOOK_WEIGHT_GRAMS,
  parcelWeightGrams,
  SHIPPING_ZONES,
  shippingCentsFor,
  shippingTiers,
  TIER_REGION_SLUG,
  tierOfRegion,
  tierOfZone,
  zoneById,
  zonesInDistrict,
} from "@sakura/contracts";
import { describe, expect, it } from "vitest";

/**
 * The zone list and the weight ladder — the two pieces of shared data every
 * postage figure is computed from, on both sides of the wire.
 *
 * Tested here rather than in the contracts package because that package has no
 * test runner, and this is the app whose money they decide.
 */

const districts = new Set(bdDivisions.flatMap((division) => division.districts));

describe("the zone list", () => {
  it("gives every zone a unique id", () => {
    const ids = SHIPPING_ZONES.map((zone) => zone.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("files every zone under a district bd-geo knows", () => {
    // `city` is what the admin queue's division filter resolves, so a
    // misspelt one is an order that no division filter ever returns.
    for (const zone of SHIPPING_ZONES) {
      expect(districts, `zone "${zone.id}" names city "${zone.city}"`).toContain(zone.city);
    }
  });

  it("reaches every district in the country", () => {
    const reached = new Set(SHIPPING_ZONES.map((zone) => zone.city));

    for (const district of districts) {
      expect(reached, `no zone delivers to ${district}`).toContain(district);
    }
  });

  it("prices Dhaka-division districts outside the city as OSD, not inside", () => {
    // The bug the zones replaced: Faridpur and Tangail are in Dhaka division,
    // and the division-based rule charged them the inside-Dhaka rate.
    expect(tierOfZone("faridpur")).toBe("OSD");
    expect(tierOfZone("tangail")).toBe("OSD");
    expect(tierOfZone("savar-keraniganj")).toBe("SUBURB");
    expect(tierOfZone("dhaka-city")).toBe("ISD");
  });

  it("splits only the districts whose price changes inside them", () => {
    // Dhaka: city, Savar/Keraniganj ring, Dohar/Nawabganj. Munshiganj:
    // Gazaria or the rest. Gazipur and Narayanganj are one suburb price each.
    expect(zonesInDistrict("Dhaka").map((zone) => zone.tier)).toEqual(["ISD", "SUBURB", "OSD"]);
    expect(
      zonesInDistrict("Munshiganj")
        .map((zone) => zone.tier)
        .sort(),
    ).toEqual(["OSD", "SUBURB"]);
    expect(zonesInDistrict("Gazipur").map((zone) => zone.tier)).toEqual(["SUBURB"]);
    expect(zonesInDistrict("Narayanganj").map((zone) => zone.tier)).toEqual(["SUBURB"]);

    for (const district of districts) {
      if (district === "Dhaka" || district === "Munshiganj") continue;
      expect(zonesInDistrict(district), district).toHaveLength(1);
    }
  });

  it("maps each tier to its delivery_regions slug and back", () => {
    for (const tier of shippingTiers) {
      expect(tierOfRegion(TIER_REGION_SLUG[tier])).toBe(tier);
    }
    expect(tierOfRegion("dhaka")).toBeUndefined();
  });

  it("resolves nothing for an unknown or empty id", () => {
    expect(zoneById("atlantis")).toBeUndefined();
    expect(zoneById("")).toBeUndefined();
    expect(tierOfZone(undefined)).toBeUndefined();
  });
});

describe("parcel weight", () => {
  it("counts an unweighed book at the default packed weight", () => {
    expect(parcelWeightGrams([{ weightGrams: null, quantity: 2 }])).toBe(
      2 * DEFAULT_BOOK_WEIGHT_GRAMS,
    );
  });

  it("uses a book's own weight when it has one", () => {
    expect(
      parcelWeightGrams([
        { weightGrams: 400, quantity: 1 },
        { weightGrams: undefined, quantity: 1 },
      ]),
    ).toBe(400 + DEFAULT_BOOK_WEIGHT_GRAMS);
  });

  it("weighs an empty parcel at nothing", () => {
    expect(parcelWeightGrams([])).toBe(0);
  });

  it("keeps two unweighed books in the first band and four in the second", () => {
    // The reason the default is 249g and not 250g.
    expect(parcelWeightGrams([{ weightGrams: null, quantity: 2 }])).toBeLessThanOrEqual(500);
    expect(parcelWeightGrams([{ weightGrams: null, quantity: 4 }])).toBeLessThanOrEqual(1000);
  });
});

describe("shippingCentsFor", () => {
  it("prices each band of the inside-Dhaka ladder", () => {
    expect(shippingCentsFor("ISD", 498)).toBe(6000);
    expect(shippingCentsFor("ISD", 500)).toBe(6000);
    expect(shippingCentsFor("ISD", 501)).toBe(7000);
    expect(shippingCentsFor("ISD", 1000)).toBe(7000);
    expect(shippingCentsFor("ISD", 2000)).toBe(9000);
  });

  it("prices the suburb and outside-Dhaka start prices", () => {
    expect(shippingCentsFor("SUBURB", 300)).toBe(8000);
    expect(shippingCentsFor("OSD", 300)).toBe(11000);
    expect(shippingCentsFor("OSD", 900)).toBe(13000);
  });

  it("charges every part-kilogram above 2kg as a whole one", () => {
    // Pathao bills per kg or part thereof: 2.1kg costs what 3kg does.
    expect(shippingCentsFor("ISD", 2100)).toBe(9000 + 1500);
    expect(shippingCentsFor("ISD", 3000)).toBe(9000 + 1500);
    expect(shippingCentsFor("ISD", 3001)).toBe(9000 + 2 * 1500);
  });

  it("moves the whole ladder with a start price saved by staff", () => {
    expect(shippingCentsFor("OSD", 300, 12000)).toBe(12000);
    expect(shippingCentsFor("OSD", 900, 12000)).toBe(14000);
    expect(shippingCentsFor("OSD", 2500, 12000)).toBe(18000 + 2500);
  });

  it("treats a null start price as the ladder's default", () => {
    expect(shippingCentsFor("SUBURB", 300, null)).toBe(8000);
  });
});
