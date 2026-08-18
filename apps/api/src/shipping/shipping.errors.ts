import { InvalidInputError } from "../common/errors";

/**
 * A region slug that is not one we deliver to.
 *
 * Not a NOT_FOUND: nobody navigated to a region resource, they submitted a
 * checkout form whose region field failed a check the schema could not express
 * — the valid set lives in a table. INVALID_INPUT puts it in the same bucket as
 * every other server-side field rejection, which is where the checkout form's
 * error handling already looks.
 */
export class UnknownRegionError extends InvalidInputError {
  constructor(slug: string) {
    super(`We do not deliver to '${slug}'.`, { field: "region", slug });
  }
}
