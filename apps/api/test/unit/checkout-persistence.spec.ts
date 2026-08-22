import { getTableColumns } from "drizzle-orm";
import { checkoutDefaults, type PlaceOrderRequest } from "@sakura/contracts";
import { describe, expect, it } from "vitest";
import { orderValuesFrom } from "../../src/orders/checkout.service";
import { orders } from "../../src/db/schema";

/**
 * Every field the checkout form collects must have somewhere on `orders` to
 * land.
 *
 * This exists because of a real, silent bug: `checkoutSchema` required
 * `senderNumber` and `transactionId` for manual transfers, the API validated
 * them, and CheckoutService's insert simply never mentioned them. Nothing
 * failed — no type error, no test, no runtime complaint. The shop collected
 * bKash receipts from customers and dropped them on the floor, and the only
 * way to notice was to go looking for a transaction ID that was never there.
 *
 * A test asserting the *shape* of the insert would not have caught it either,
 * since the insert was internally consistent. What catches it is this: force
 * every checkout field to be assigned a destination, on purpose, in a table
 * someone has to edit when the form grows.
 */

/**
 * Where each checkout field is stored. `null` means "deliberately not
 * persisted on the order" — and a field can only be given that value by
 * someone writing it here and saying why.
 */
const DESTINATIONS: Record<string, keyof typeof orders.$inferInsert | null> = {
  fullName: "customerName",
  email: "customerEmail",
  phone: "customerPhone",
  method: "paymentMethod",
  senderNumber: "senderNumber",
  transactionId: "transactionId",
  notes: "customerNote",

  /* The three address parts are folded into the `shipping_address` jsonb
     rather than getting columns of their own — one value the courier reads,
     not three the queue has to reassemble. */
  address: "shippingAddress",
  city: "shippingAddress",
  region: "shippingAddress",
};

describe("checkout fields reach the orders table", () => {
  /* Read off `checkoutDefaults` rather than the schema's shape: `checkoutSchema`
     is wrapped in a superRefine, so its fields sit behind a ZodEffects whose
     internals move between Zod versions. The defaults object is typed as
     `CheckoutValues`, so it cannot fall out of step with the schema without a
     type error — it is the same field set, reachable without private API. */
  const checkoutFields = Object.keys(checkoutDefaults);
  const orderColumns = new Set(Object.keys(getTableColumns(orders)));

  it("assigns every checkout field a destination", () => {
    /* If this fails, a field was added to the checkout form and nobody decided
       where it is stored. Add it to DESTINATIONS — with a column, or with null
       and a comment explaining why the answer is "nowhere". */
    for (const field of checkoutFields) {
      expect(DESTINATIONS, `checkout field "${field}" has no recorded destination`).toHaveProperty(
        field,
      );
    }
  });

  it("points every destination at a column that exists", () => {
    for (const [field, column] of Object.entries(DESTINATIONS)) {
      if (column === null) continue;

      expect(orderColumns, `"${field}" is stored as a column that does not exist`).toContain(
        column,
      );
    }
  });

  it("keeps a column for the manual-transfer receipt", () => {
    /* The specific regression. `checkoutSchema` makes both mandatory whenever
       the method is manual-transfer, so losing either column again would mean
       validating a receipt and discarding it a second time. */
    expect(orderColumns).toContain("senderNumber");
    expect(orderColumns).toContain("transactionId");
  });
});

describe("orderValuesFrom", () => {
  const request = (customer: Partial<PlaceOrderRequest["customer"]>) =>
    ({
      items: [{ bookId: "b", quantity: 1 }],
      customer: {
        fullName: "Rumana Haque",
        email: "rumana@example.com",
        phone: "01700000000",
        address: "12 Green Road",
        city: "Dhaka",
        region: "inside-dhaka",
        method: "manual-transfer",
        ...customer,
      },
    }) as PlaceOrderRequest;

  const priced = {
    lines: [],
    subtotalCents: 29900,
    deliveryCents: 6000,
    totalCents: 35900,
    coupon: undefined,
    rejected: [],
  } as never;

  it("carries the manual-transfer receipt onto the order row", () => {
    /* The regression this file exists for. Both fields are required by
       checkoutSchema for manual transfers, and both used to be dropped here. */
    const values = orderValuesFrom(
      request({ senderNumber: "01711111111", transactionId: "BKH7X2QM10" }),
      priced,
      "idem-1",
    );

    expect(values.senderNumber).toBe("01711111111");
    expect(values.transactionId).toBe("BKH7X2QM10");
  });

  it("stores an absent receipt as null, not an empty string", () => {
    /* `checkoutDefaults` posts "" for both whenever cash on delivery is
       chosen, so without normalising, "no receipt given" would be two
       different stored values and every later check would need to know both. */
    const values = orderValuesFrom(
      request({ method: "cash-on-delivery", senderNumber: "", transactionId: "   " }),
      priced,
      "idem-2",
    );

    expect(values.senderNumber).toBeNull();
    expect(values.transactionId).toBeNull();
  });

  it("never lets the client dictate the total", () => {
    // The money comes from `priced`, which the server computed — §3.8.
    const values = orderValuesFrom(request({}), priced, "idem-3");

    expect(values.totalCents).toBe(35900);
    expect(values.subtotalCents).toBe(29900);
  });
});
