import { describe, expect, it } from "vitest";
import { ResourceNotFoundError } from "../../src/common/errors";
import { WaitlistBooksService } from "../../src/waitlist/waitlist-books.service";
import type { Transaction } from "../../src/db/db.types";

/**
 * Which titles /notify offers is a set staff replace outright, and the two
 * ways that write can go wrong are both silent.
 *
 * Clearing without setting leaves the page offering nothing. Setting without
 * clearing leaves a title on the page after someone unticked it — which reads,
 * to whoever unticked it, as the panel having saved and lied. Both would look
 * like a successful save from the panel, so the ordering and the row count are
 * what these tests pin down.
 */

/** Records the update statements a call issues, in order. */
function fakeTx(matchedIds: string[]) {
  const calls: { set: unknown; cleared: boolean }[] = [];

  const tx = {
    update: () => ({
      set: (values: { waitlistEnabled: boolean }) => {
        const enabling = values.waitlistEnabled;
        calls.push({ set: values, cleared: !enabling });

        return {
          where: () =>
            enabling
              ? {
                  returning: () => Promise.resolve(matchedIds.map((id) => ({ id }))),
                  then: undefined,
                }
              : Promise.resolve(undefined),
        };
      },
    }),
  } as unknown as Transaction;

  return { tx, calls };
}

const service = new WaitlistBooksService({} as never);

describe("WaitlistBooksService.setSelection", () => {
  it("clears the whole selection before enabling the chosen titles", async () => {
    const { tx, calls } = fakeTx(["a", "b"]);

    await service.setSelection(["a", "b"], tx);

    expect(calls.map((call) => call.cleared)).toEqual([true, false]);
  });

  it("clears and stops when the selection is empty — offering nothing is a real state", async () => {
    const { tx, calls } = fakeTx([]);

    await service.setSelection([], tx);

    expect(calls).toHaveLength(1);
    expect(calls[0].cleared).toBe(true);
  });

  it("refuses a selection naming a book that no longer exists", async () => {
    // Two ids sent, one row matched — the deleted title must not be dropped
    // from the save quietly.
    const { tx } = fakeTx(["a"]);

    await expect(service.setSelection(["a", "gone"], tx)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("accepts a selection that repeats an id", async () => {
    // The panel sends a Set, but a duplicate must not read as an unmatched row.
    const { tx } = fakeTx(["a"]);

    await expect(service.setSelection(["a", "a"], tx)).resolves.toBeUndefined();
  });
});
