/* --------------------------------------------------------------------------
   Where customers reach the shop.

   One place, because the Messenger link now does two jobs: the contact page's
   "message us" button, and the step that confirms a cash-on-delivery order
   (docs/cod-orders.md). A page renamed on Facebook must not leave one of them
   pointing at the old handle.
   -------------------------------------------------------------------------- */

export const SHOP_EMAIL = "contact@nihonovaacademy.com";
export const SHOP_MESSENGER_URL = "https://m.me/nihonovaacademy";
export const SHOP_FACEBOOK_URL = "https://www.facebook.com/nihonovaacademy/";

/**
 * The Messenger link with a first message already typed.
 *
 * `m.me` takes the draft as `?text=`; the customer still has to press send, so
 * this only saves them typing the order number — and saves staff asking for
 * it, which is the part that matters.
 */
export function messengerDraftUrl(text: string): string {
  return `${SHOP_MESSENGER_URL}?text=${encodeURIComponent(text)}`;
}
