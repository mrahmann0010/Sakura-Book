// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Bounded contexts. Adding a directory here is what makes it a module rather
 * than just a folder: from that point on, code outside it may only reach it
 * through its index.ts barrel.
 */
const FEATURE_MODULES = [
  "catalog",
  "pricing",
  "coupons",
  "inventory",
  "checkout",
  "orders",
  "payments",
  "admin",
];

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The schema tree groups tables into catalog/ orders/ marketing/ folders
    // that happen to share names with modules, but it is global infrastructure
    // with one deliberate barrel (db/schema/index.ts) that drizzle-kit and
    // drizzle() both consume wholesale. Its internal cross-references are the
    // foreign keys, and they are supposed to be there.
    ignores: ["src/db/**"],
    rules: {
      /**
       * Feature folders only pay for themselves if crossing a boundary is a
       * deliberate act. Without this, `import { CouponsService } from
       * "../coupons/coupons.service"` works, and within a month every module's
       * internals are load-bearing for three others — which is the layer-first
       * coupling we chose feature folders to avoid, just with different
       * directory names.
       *
       * The patterns match import *strings*, so a module's own files
       * ("./coupon.errors", "./books/books.service") are untouched: they carry
       * no `<module>/` segment relative to themselves. Only paths that climb
       * out and back down into a sibling match.
       */
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: FEATURE_MODULES.map((name) => `**/${name}/*`),
              message:
                "Import a feature module through its barrel (e.g. `../coupons`), not its internals. " +
                "If what you need is not exported from index.ts, decide whether it should be part of " +
                "that module's public surface — or whether the call belongs in checkout instead.",
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * There is no repository layer, by decision (§3.2). Services call Drizzle,
     * and the Executor parameter provides the one thing a repository would
     * have been introduced for.
     *
     * This is here because "no repository layer" is an absence, and absences
     * do not survive contact with a new contributor who reaches for the
     * pattern out of habit. A file named for it fails the build with the
     * reasoning attached, which is cheaper than finding it in review after the
     * second one has been written against it.
     */
    files: ["**/*.repository.ts", "**/repositories/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "No repository layer — see docs/backend-architecture.md §3.2. Drizzle is already the " +
            "data-access abstraction; put the query in the service and take an `Executor` so it " +
            "can run inside a caller's transaction. If this is about testing, the answer is a real " +
            "Postgres (§3.18), not a mock — a mock cannot have a unique index.",
        },
      ],
    },
  },
);
