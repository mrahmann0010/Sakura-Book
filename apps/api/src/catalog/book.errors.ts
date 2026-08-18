import { ResourceNotFoundError } from "../common/errors";

/**
 * No book with that slug — or one that exists and is no longer for sale.
 *
 * The two collapse deliberately. A delisted title is not on the shelf, and
 * distinguishing "never existed" from "we took it down" in a public response
 * tells a scraper which of its guessed slugs were real. The 410-for-delisted
 * flourish is worth less than that.
 */
export class BookNotFoundError extends ResourceNotFoundError {
  constructor(slug: string) {
    super("Book", slug);
  }
}

export class AuthorNotFoundError extends ResourceNotFoundError {
  constructor(slug: string) {
    super("Author", slug);
  }
}
