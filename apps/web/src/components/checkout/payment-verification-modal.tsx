"use client";

import { useTranslation } from "react-i18next";

import { Button, Modal, Spinner } from "@/components/ui";

/* --------------------------------------------------------------------------
   The modal a shopper sees between pressing "Place order" and landing on the
   confirmation page.

   Three states, not a boolean: "verifying" is the only one with a spinner,
   and "verified" / "unverified" are both *successful* outcomes — the order
   exists either way, and the only thing that differs is whether it still
   needs a person to look at it. Collapsing that into "done" / "not done"
   would make an unmatched receipt read like a failure, when the actual
   failure case (the request itself erroring) never reaches this component —
   that stays on the page as the existing submit-error notice.

   Stateless and reusable on purpose: the caller owns the timing (how long
   "verifying" is shown, when the shopper is allowed to move on), this only
   ever renders what it is told.

   "verifying" has no button and no dismissal — it is a transient,
   machine-timed state with nothing yet to act on, so Escape and a backdrop
   click are quietly no-ops while it is open. Once the result is in, either
   outcome is something the order already survived — the order exists either
   way — so both show the same single action, "See order info": the wording
   doesn't hedge on which outcome it was, only the title/description above it
   does.
   -------------------------------------------------------------------------- */

export type PaymentVerificationStatus = "verifying" | "verified" | "unverified";

export function PaymentVerificationModal({
  status,
  onSeeOrder,
}: {
  /** `null` renders nothing — the modal is closed. */
  status: PaymentVerificationStatus | null;
  /** Called when the shopper closes a resolved (verified/unverified) modal. */
  onSeeOrder: () => void;
}) {
  const { t } = useTranslation();

  if (!status) return null;

  const resolved = status !== "verifying";
  const title = t(`checkout.verify.${status}.title`);
  const description = t(`checkout.verify.${status}.description`);

  return (
    <Modal
      open
      onClose={resolved ? onSeeOrder : () => {}}
      title={title}
      description={description}
      size="sm"
      actions={
        resolved ? (
          <Button onClick={onSeeOrder}>{t("checkout.verify.seeOrder")}</Button>
        ) : undefined
      }
    >
      {status === "verifying" ? (
        <div className="flex items-center gap-3">
          <Spinner label={null} />
          <p className="text-13 text-secondary">{t("checkout.verify.verifying.hint")}</p>
        </div>
      ) : null}
    </Modal>
  );
}
