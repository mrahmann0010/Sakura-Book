import type { PaymentProvider } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   Which option in the wallet app's own menu a buyer has to tap.

   bKash is a merchant account, so a buyer must tap "Payment" — a Send Money
   transfer to a merchant number cannot be verified. Rocket and Nagad are
   still personal numbers, where "Send Money" is the only option that lands.

   Every piece of copy that names the option resolves it through here rather
   than repeating the condition, so moving another wallet to a merchant
   account is one line in one file.
   -------------------------------------------------------------------------- */

/** The i18n sub-namespace under `checkout.payment.walletOption` whose copy
    names the right menu option for this wallet. */
export type WalletMenuOption = "payment" | "sendMoney";

export function walletMenuOption(provider: PaymentProvider): WalletMenuOption {
  return provider === "bkash" ? "payment" : "sendMoney";
}
