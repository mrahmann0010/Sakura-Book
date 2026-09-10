import { DrizzleQueryError } from "drizzle-orm/errors";
import { PostgresError } from "postgres";
import { describe, expect, it } from "vitest";
import { mapPostgresError, toPostgresError } from "../../src/common/errors/postgres-error.mapper";

/**
 * Finding the driver's error inside whatever threw.
 *
 * The wrapping is the whole point of these tests. Every rule in the mapper was
 * written against a bare `PostgresError`, and drizzle stopped throwing one:
 * since 0.44 a failed statement arrives as `DrizzleQueryError` with the real
 * error on `cause`. Nothing about the mapper looked broken — it simply stopped
 * being reached, and every constraint this schema enforces started answering
 * 500. A test that hands the mapper a bare error would still pass today and
 * would have passed all the way through that regression, so these hand it what
 * a service actually catches.
 */
describe("toPostgresError", () => {
  const uniqueViolation = (constraint: string) =>
    new PostgresError({
      message: `duplicate key value violates unique constraint "${constraint}"`,
      code: "23505",
      constraint_name: constraint,
      table_name: "waitlist_entries",
    });

  const wrapped = (cause: Error) => new DrizzleQueryError("insert into ...", [], cause);

  it("finds the driver error drizzle wrapped a failed statement in", () => {
    const cause = uniqueViolation("waitlist_entries_phone_book_idx");

    expect(toPostgresError(wrapped(cause))).toBe(cause);
  });

  it("finds one nested several wrappers deep", () => {
    const cause = uniqueViolation("waitlist_entries_phone_book_idx");
    const outer = new Error("Transaction failed", { cause: wrapped(cause) });

    expect(toPostgresError(outer)).toBe(cause);
  });

  it("still recognises a bare driver error", () => {
    const cause = uniqueViolation("waitlist_entries_phone_book_idx");

    expect(toPostgresError(cause)).toBe(cause);
  });

  it("returns undefined for an error that is not a database failure", () => {
    expect(toPostgresError(new Error("boom"))).toBeUndefined();
    expect(toPostgresError("boom")).toBeUndefined();
    expect(toPostgresError(undefined)).toBeUndefined();
  });

  /* A cause that points back at its own error would otherwise spin forever on
     the error path — the one path that must not be able to hang. */
  it("gives up rather than looping on a self-referencing cause chain", () => {
    const looping = new Error("round and round");
    looping.cause = looping;

    expect(toPostgresError(looping)).toBeUndefined();
  });

  it("maps the unwrapped violation to a conflict, not an opaque failure", () => {
    const mapped = mapPostgresError(
      toPostgresError(wrapped(uniqueViolation("waitlist_entries_phone_book_idx")))!,
    );

    expect(mapped?.status).toBe(409);
    expect(mapped?.message).toContain("waitlist_entries");
  });
});
