"use client";

import { useTranslation } from "react-i18next";

import { Modal, Spinner } from "@/components/ui";

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
   "verifying" is shown, when to advance past the result), this only ever
   renders what it is told.
   -------------------------------------------------------------------------- */

export type PaymentVerificationStatus = "verifying" | "verified" | "unverified";

export function PaymentVerificationModal({
  status,
}: {
  /** `null` renders nothing — the modal is closed. */
  status: PaymentVerificationStatus | null;
}) {
  const { t } = useTranslation();

  if (!status) return null;

  const title = t(`checkout.verify.${status}.title`);
  const description = t(`checkout.verify.${status}.description`);

  return (
    <Modal
      open
      // No dismissal: this is a transient, machine-timed state, not
      // something the shopper is meant to interact with or back out of —
      // Escape and a backdrop click are quietly no-ops while it is open.
      onClose={() => {}}
      title={title}
      description={description}
      size="sm"
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
