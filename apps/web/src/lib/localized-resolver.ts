import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";

/* --------------------------------------------------------------------------
   Validation messages in the shopper's language.

   The schemas live in @sakura/contracts and are shared with the API, so their
   messages are English — that is what the API logs and staff read. The form
   shows them through this table instead: each English message maps to a key
   under `validation`, and anything not in the table is shown as written, so
   a new message on the schema reads in English until it is added here
   rather than vanishing.
   -------------------------------------------------------------------------- */

const MESSAGE_KEYS: Record<string, string> = {
  "Add the name the parcel should be addressed to.": "fullName",
  "Use an address like you@example.com so we can send updates.": "email",
  "Add a number the courier can reach you on.": "phone",
  "Add the street, house and area so the courier can find you.": "address",
  "Add the town or city.": "city",
  "Choose your area so we can price delivery.": "zone",
  "Choose your area from the list.": "zoneUnknown",
  "Keep delivery notes under 500 characters.": "notesTooLong",
  "Choose which wallet you paid with.": "provider",
  "Add the number you sent the money from.": "senderNumber",
  "Enter the 11-digit wallet number you paid from, like 01XXXXXXXXX.": "senderNumberFormat",
  "Add the transaction ID from your payment confirmation.": "transactionId",
  "Your basket is empty.": "emptyBasket",
  "Tick the box to confirm you will pay the total on delivery.": "codAcknowledged",
};

/** One schema message in the current language, or as written if unmapped. */
export function localizeMessage(t: TFunction, message: string): string {
  const key = MESSAGE_KEYS[message];

  return key ? t(`validation.${key}`, { defaultValue: message }) : message;
}

function localizeErrors(errors: FieldErrors, t: TFunction): FieldErrors {
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== "object") continue;
    const error = value as { message?: unknown };

    if (typeof error.message === "string") {
      error.message = localizeMessage(t, error.message);
    } else {
      localizeErrors(value as FieldErrors, t);
    }
  }

  return errors;
}

/**
 * zodResolver, with each error's message translated. `t` is read on every
 * validation, so switching language re-words the next error shown.
 */
export function localizedZodResolver<T extends FieldValues>(
  schema: Parameters<typeof zodResolver>[0],
  t: TFunction,
): Resolver<T> {
  const base = zodResolver(schema) as unknown as Resolver<T>;

  return async (values, context, options) => {
    const result = await base(values, context, options);

    localizeErrors(result.errors as FieldErrors, t);

    return result;
  };
}
