import { describe, expect, it } from "vitest";
import type { ShippingAddress } from "../../src/db/schema";
import {
  amountToCollect,
  recipientAddress,
  recipientPhone,
  recipientPlace,
  toPathaoCsv,
  type PathaoExportRow,
} from "../../src/admin/orders/pathao-export";

/**
 * The Pathao bulk-order CSV.
 *
 * Worth testing without a database because every failure here is silent on our
 * side and expensive on theirs: a header Pathao does not recognise rejects the
 * whole upload, a `+880` phone rejects one row, and an amount to collect on an
 * order that is already paid charges a customer twice for a book they have
 * bought. None of those show up on any screen in this app.
 */

const STORE = "Nihonova Academy";

function shipping(overrides: Partial<ShippingAddress> = {}): ShippingAddress {
  return {
    address: "H-1,R-1,S-6, Uttara",
    city: "Dhaka",
    region: "inside-dhaka",
    ...overrides,
  };
}

/** Name and phone are columns on `orders`, not fields of the frozen address. */
function row(overrides: Partial<PathaoExportRow> = {}): PathaoExportRow {
  return {
    orderNumber: "NB-40718",
    customerName: "Mr Xyz",
    customerPhone: "01710000000",
    shippingAddress: shipping(),
    paymentMethod: "cash-on-delivery",
    totalCents: 100_000,
    customerNote: null,
    itemCount: 1,
    ...overrides,
  };
}

describe("toPathaoCsv", () => {
  it("writes Pathao's header row verbatim", () => {
    // Matched by name on import. Tidying `RecipientName(*)` into something
    // that reads better is a file their importer refuses with no useful error.
    const [header] = toPathaoCsv([], STORE)
      .replace(/^\uFEFF/, "")
      .split("\r\n");

    expect(header).toBe(
      "ItemType,StoreName,MerchantOrderId,RecipientName(*),RecipientPhone(*)," +
        "RecipientAddress(*),RecipientCity(*),RecipientZone(*),RecipientArea," +
        "AmountToCollect(*),ItemQuantity,ItemWeight,ItemDesc,SpecialInstruction",
    );
  });

  it("renders a row in the same shape as Pathao's own sample", () => {
    const [, first] = toPathaoCsv([row()], STORE).split("\r\n");

    // The district is appended to the address line as well as carried in its
    // own column: the rider reads the address, and half of these are typed
    // without a district because the form asked for it separately. The
    // customer's own spacing is otherwise left alone.
    expect(first).toBe(
      'parcel,Nihonova Academy,NB-40718,Mr Xyz,01710000000,"H-1,R-1,S-6, Uttara, Dhaka",Dhaka,Uttara,Sector 6,1000,1,0.25,,',
    );
  });

  it("quotes only the cells that need it, as the sample does", () => {
    // Quoting every field is valid CSV and is what the waitlist export does,
    // but that file is read by a person in Excel. This one is read by a
    // machine, so it stays shaped like the template it is answering.
    const [, first] = toPathaoCsv([row()], STORE).split("\r\n");

    expect(first.startsWith("parcel,")).toBe(true);
    expect(first).toContain('"H-1,R-1,S-6, Uttara, Dhaka"');
    // City, zone and area unquoted — "Sector 6" holds a space, not a comma.
    expect(first).toContain(",Dhaka,Uttara,Sector 6,");
  });

  it("leads with a byte-order mark, so Bangla survives the upload", () => {
    // Shipped without one, on the argument that a parser which does not strip
    // it sees a BOM-prefixed first column. Pathao then rendered every Bangla address as
    // Latin-1 mojibake, which is the worse failure: a .csv carries no encoding
    // inside it and this is the only signal left to send.
    expect(toPathaoCsv([row()], STORE).startsWith("\uFEFFItemType")).toBe(true);
  });

  it("writes the bytes that make Bangla readable, not the ones that mangled it", () => {
    // The exact failure reported from Pathao's panel: হাসপাতাল came back as
    // `à¦¹à¦¾...`, which is these bytes read one at a time as Latin-1.
    const csv = toPathaoCsv(
      [row({ shippingAddress: shipping({ address: "Dhamaran (হাসপাতাল মাঠ)" }) })],
      STORE,
    );
    const bytes = Buffer.from(csv, "utf8");

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("হাসপাতাল মাঠ");
  });

  it("escapes a note containing a quote rather than breaking the row", () => {
    const csv = toPathaoCsv([row({ customerNote: 'Ring the "back" bell' })], STORE);

    expect(csv).toContain('"Ring the ""back"" bell"');
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("collapses a multi-line note into one cell", () => {
    // The checkout note is a textarea. A raw newline mid-row would end the
    // record early and shift every remaining column by one.
    const csv = toPathaoCsv([row({ customerNote: "Call first.\nGate is round the back." })], STORE);

    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
    expect(csv).toContain("Call first. Gate is round the back.");
  });

  it("neutralises an address that a spreadsheet would run as a formula", () => {
    const csv = toPathaoCsv(
      [row({ shippingAddress: shipping({ address: "=HYPERLINK(1)" }) })],
      STORE,
    );

    expect(csv).toContain(`"'=HYPERLINK(1), Dhaka"`);
  });

  it("takes the store name from configuration rather than baking it in", () => {
    // It has to match the store on the merchant's Pathao account exactly.
    expect(toPathaoCsv([row()], "Second Shop")).toContain("parcel,Second Shop,NB-40718");
  });
});

describe("recipientPhone", () => {
  it("passes a local 11-digit number through", () => {
    expect(recipientPhone("01710000000")).toBe("01710000000");
  });

  it.each([
    ["+8801710000000", "01710000000"],
    ["8801710000000", "01710000000"],
    ["008801710000000", "01710000000"],
    ["+880 1710-000000", "01710000000"],
    ["01710 000 000", "01710000000"],
  ])("normalises %s to the local form Pathao wants", (raw, expected) => {
    // Checkout stores whatever was typed — see OrdersService.lookup — so all
    // of these are real values for one number.
    expect(recipientPhone(raw)).toBe(expected);
  });

  it("returns the bare digits of anything it cannot recognise", () => {
    // Visible and fixable in the sheet. An empty cell is neither.
    expect(recipientPhone("+44 20 7946 0000")).toBe("442079460000");
  });
});

describe("recipientAddress", () => {
  it("appends the district when the customer did not type it", () => {
    expect(recipientAddress(shipping({ address: "H-1, R-1, S-6, Uttara" }))).toBe(
      "H-1, R-1, S-6, Uttara, Dhaka",
    );
  });

  it("does not repeat a district the address already carries", () => {
    expect(recipientAddress(shipping({ address: "H-1, Uttara, Dhaka" }))).toBe(
      "H-1, Uttara, Dhaka",
    );
  });

  it("treats the district case-insensitively", () => {
    expect(recipientAddress(shipping({ address: "H-1, uttara, dhaka" }))).toBe(
      "H-1, uttara, dhaka",
    );
  });

  it("handles a district whose name contains regex punctuation", () => {
    // "Cox's Bazar" is a district and, unescaped, a regex.
    expect(recipientAddress(shipping({ address: "Kolatoli Road", city: "Cox's Bazar" }))).toBe(
      "Kolatoli Road, Cox's Bazar",
    );
  });

  it("does not append a district on a substring match", () => {
    // "Dhaka" is not present in "Dhakshin" and appending must still happen.
    expect(recipientAddress(shipping({ address: "Dhakshin Khan" }))).toBe("Dhakshin Khan, Dhaka");
  });
});

describe("recipientPlace", () => {
  it("reads the locality off the tail of the address", () => {
    expect(recipientPlace(shipping({ address: "H-1,R-1,S-6, Uttara" })).zone).toBe("Uttara");
  });

  it("skips the district when the customer repeated it", () => {
    expect(recipientPlace(shipping({ address: "H-1, R-1, Banani, Dhaka" })).zone).toBe("Banani");
  });

  it.each(["House 4, Road 12, Mirpur 1", "Flat 3B, Block C, Mirpur 1"])(
    "keeps a numbered zone name in %s",
    (address) => {
      // Pathao has zones like "Mirpur 1". A blanket "skip anything with a
      // digit" rule would throw them away along with the house numbers.
      expect(recipientPlace(shipping({ address })).zone).toBe("Mirpur 1");
    },
  );

  it.each(["H-1, R-1, S-6", "House 4, Road 12", "Plot 7, Block C"])(
    "finds no zone when %s is only house and road",
    (address) => {
      // Empty is the honest answer, and it is the cell an operator can spot.
      expect(recipientPlace(shipping({ address })).zone).toBe("");
    },
  );

  it("finds no zone in an address typed as one unpunctuated line", () => {
    // No commas means one part, and that part opens with a house number — so
    // there is nothing here that reads as a locality. Guessing "dhaka" off the
    // end of it would be inventing a zone from a sentence.
    expect(recipientPlace(shipping({ address: "house 4 road 12 uttara dhaka" })).zone).toBe("");
  });

  it.each([
    ["H-1,R-1,S-6, Uttara", "Sector 6"],
    ["House 4, Sec 10, Uttara", "Sector 10"],
    ["House 4, Sector 10, Uttara", "Sector 10"],
  ])("expands the sector in %s to Pathao's spelling", (address, area) => {
    // "S-6" is how a customer writes it; "Sector 6" is how Pathao stores it,
    // and the two do not match as strings.
    expect(recipientPlace(shipping({ address })).area).toBe(area);
  });

  it("reads a block as the area, upper-cased", () => {
    expect(recipientPlace(shipping({ address: "House 4, block c, Bashundhara R/A" }))).toEqual({
      zone: "Bashundhara R/A",
      area: "Block C",
    });
  });

  it("finds the area whichever side of the zone it was typed", () => {
    // "Uttara, Sector 10" and "Sector 10, Uttara" are both things people type,
    // so the area is searched across every part except the one the zone came
    // from rather than only the parts before it.
    expect(recipientPlace(shipping({ address: "House 4, Uttara, Sector 10" }))).toEqual({
      zone: "Uttara",
      area: "Sector 10",
    });
  });

  it("never returns the zone as its own area", () => {
    // "Mirpur 1" is a zone, and `B|BLK|BLOCK` must not re-read it as one.
    expect(recipientPlace(shipping({ address: "House 4, Road 12, Mirpur 1" }))).toEqual({
      zone: "Mirpur 1",
      area: "",
    });
  });

  it("leaves the area empty where the address names no sector or block", () => {
    // Most of the country is not organised into sectors. A blank optional cell
    // is right; inventing one from a road name is not.
    expect(recipientPlace(shipping({ address: "House 12, Road 5, Zindabazar" }))).toEqual({
      zone: "Zindabazar",
      area: "",
    });
  });

  it("does not read a road that merely mentions a sector as one", () => {
    expect(recipientPlace(shipping({ address: "Sector 6 main road, Uttara" })).area).toBe("");
  });

  it("reads the upazila, not the postcode line, off a real exported address", () => {
    // The row that prompted this: read literally, the zone came out
    // "Dhaka 1520" — a division and a postcode, and a parcel Pathao refuses.
    expect(
      recipientPlace({
        address: "Dhamaran (হাসপাতাল মাঠ) Dhamaran, Tangibari Munshiganj, Dhaka 1520",
        city: "Munshiganj",
        region: "outside-dhaka",
      }),
    ).toEqual({ zone: "Tangibari", area: "" });
  });

  it("drops a trailing postcode without touching a place name that ends in a digit", () => {
    // Postcodes are four digits. "Mirpur 1" is a zone.
    expect(recipientPlace(shipping({ address: "House 4, Uttara 1230" })).zone).toBe("Uttara");
    expect(recipientPlace(shipping({ address: "House 4, Mirpur 1" })).zone).toBe("Mirpur 1");
  });

  it("skips a division name written after the district", () => {
    // Munshiganj is in Dhaka division, so a trailing "Dhaka" names the region
    // of the country rather than the locality.
    expect(
      recipientPlace({ address: "Sirajdikhan, Dhaka", city: "Munshiganj", region: "outside-dhaka" })
        .zone,
    ).toBe("Sirajdikhan");
  });

  it("keeps a zone that only opens with the district", () => {
    // The district is trimmed off the end, not wherever it appears — otherwise
    // "Munshiganj Sadar" would lose the half that names the zone.
    expect(
      recipientPlace({
        address: "House 4, Munshiganj Sadar",
        city: "Munshiganj",
        region: "outside-dhaka",
      }).zone,
    ).toBe("Munshiganj Sadar");
  });
});

describe("amountToCollect", () => {
  it("is the order total in taka for cash on delivery", () => {
    expect(amountToCollect(row({ paymentMethod: "cash-on-delivery", totalCents: 145_000 }))).toBe(
      1450,
    );
  });

  it("is zero once the money is already in", () => {
    // A manual transfer only reaches this list after a staff member confirmed
    // it. Collecting again would charge the customer twice.
    expect(amountToCollect(row({ paymentMethod: "manual-transfer", totalCents: 145_000 }))).toBe(0);
  });

  it("rounds to whole taka, because a rider collects cash", () => {
    expect(amountToCollect(row({ totalCents: 145_050 }))).toBe(1451);
  });
});
