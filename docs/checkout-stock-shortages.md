# Checkout stock shortages

How the storefront handles a cart line that asks for more copies than the
shopper can have, and the two gaps still open.

## Background

A customer saw this at checkout, in English, under a Bangla page:

> Book 2ff1c06a-e16a-496a-bd71-a007c53a63b1: requested 3, 1 available

It is `OutOfStockError` (`apps/api/src/inventory/inventory.errors.ts`), thrown
by the guarded decrement in `InventoryService.decrement` when the order is
placed. The checkout page showed `err.message` as received.

The page let the customer get there because:

- `POST /cart/quote` rejects a line only when **zero** copies are free
  (`rejectionFor` in `apps/api/src/pricing/pricing.service.ts`). A line short
  of its quantity is still priced at the full quantity, with the free count in
  `stockQuantity`.
- The web cart raised the stepper's ceiling to meet the quantity
  (`maxQuantity = max(quantity, stock)`), so nothing flagged a short line.
  Checkout even showed "only 3 left" for a title with 1.

"Free" means the shelf count minus copies held by other shoppers' live
waitlist invites, so a title can show stock on its page and still be short.

## How it works now

- `CartLine.available` (`apps/web/src/lib/cart.ts`) is the quote's free count,
  not raised to meet the quantity. It is `null` for a pre-order.
- `apps/web/src/lib/stock-shortage.ts` finds shortages in one shape from two
  places:
  - `shortagesFromCart`: priced lines with `quantity > available`, plus lines
    the quote rejected that are still in the cart.
  - `shortagesFromError`: an order refusal with code `OUT_OF_STOCK` (409, one
    book, `details.bookId/requested/available`) or `CART_NOT_ORDERABLE` (422,
    `details.rejected[]`).
- `StockShortageNotice` (`apps/web/src/components/cart/stock-shortage-notice.tsx`)
  names each book with a "Change to N" button, or "Remove" when it is sold
  out. The cart page and checkout both use it.
- Checkout blocks "Continue to payment" and "Place order" while a shortage
  is showing. A server refusal returns the shopper to the delivery step,
  re-fetches the quote, and shows the notice.
- Any other order error shows `checkout.submitError` rather than the server's
  English message. A reused transaction ID still has its own copy and link.
- The invite checkout shows the same translated sentence as text.

Copy is in `cart.stock.*` in all three locales.

## Open gaps

### 1. A shopper who loses a race may already have paid the full total

The pre-payment check stops a shortage the quote already knows about. It
cannot stop a race: someone else buys the last copies while this shopper is
in the bKash app. The order is then refused with `OUT_OF_STOCK` after they
have sent the money for the original quantity (for example ৳1,177 for 3
copies, when 1 copy plus delivery is about ৳479).

The notice tells them to reduce the quantity. It says nothing about the money
already sent, because the shop has not decided what to promise: a refund of
the difference, store credit, or staff contact. The payment claim also needs
checking, so that an overpaid receipt is accepted against the smaller order
and its surplus is recorded (`PAYMENT_UNDERPAID` covers only the opposite
case).

To fix: decide the policy, then add a line to the notice on a refusal that
arrives from the payment step, and make sure the claim flow handles
overpayment.

### 2. Sold-out lines have no title

A line the quote rejects outright (`CartQuoteRejection`: `NOT_FOUND`,
`UNAVAILABLE`, or `OUT_OF_STOCK` with zero free) carries only `bookId`, so the
notice says "A book in your cart" (`cart.stock.unknownTitle`). The same is
true of a `CART_NOT_ORDERABLE` refusal for a book the quote never priced.

To fix: add `title` (and perhaps `slug`) to `cartQuoteRejectionSchema` in
`packages/contracts/src/cart.ts` and fill it in `rejectionFor` when the book
row exists (it does for `UNAVAILABLE` and `OUT_OF_STOCK`; not for
`NOT_FOUND`). `shortagesFromCart` can then pass it through.
