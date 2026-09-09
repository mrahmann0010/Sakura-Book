-- The three invite columns move as one, and a spent invite keeps its token.
--
-- `waitlist_entries.invite_token`, `invite_mode` and `invite_expires_at` have
-- always been documented as being written together and cleared together, and
-- both `redeem` and `consume` assert non-null on the latter two off the back of
-- a token match alone. Nothing enforced it. Half-written state is not a missing
-- null check: a token with no expiry outlives the copies it reserved, and a
-- token with no mode reaches `consume`, which hands `undefined` to a
-- LOCKED/OPEN branch and lets the order through with no cart check at all.
--
-- The repairs run first and in this order, because each one can create rows the
-- next has to clean up, and because neither constraint can be added over rows
-- that already violate it.
--
-- Every statement is idempotent, for the reason 0033 spells out: this database
-- refuses connections from anywhere but its own host, so there is a real chance
-- of a migration being applied by hand in a container shell and then met again
-- later by `drizzle-kit migrate` from a machine that has the journal but not the
-- record of that run.

-- 1. A token with a piece missing is not a usable invite, and its mode cannot be
--    reconstructed — LOCKED and OPEN mean different things at checkout and
--    guessing would be guessing about what the shop promised someone. Revoked
--    whole instead. Any copies it was holding return to the shelf, which is the
--    right outcome for a link that could not have been honoured correctly.
UPDATE "waitlist_entries"
SET "invite_token" = NULL, "invite_mode" = NULL, "invite_expires_at" = NULL
WHERE "invite_token" IS NOT NULL
  AND ("invite_mode" IS NULL OR "invite_expires_at" IS NULL);
--> statement-breakpoint

-- 2. Mode or expiry left behind with no token: leftovers of an invite that no
--    longer exists. Nothing reads them without a token, so clearing them loses
--    no fact.
UPDATE "waitlist_entries"
SET "invite_mode" = NULL, "invite_expires_at" = NULL
WHERE "invite_token" IS NULL
  AND ("invite_mode" IS NOT NULL OR "invite_expires_at" IS NOT NULL);
--> statement-breakpoint

-- 3. A used stamp with no token to refer to. This should not exist — only
--    `consume` writes the column, and it only ever matches a row holding a live
--    token — but step 1 above can produce one, and so could any historical
--    hand-edit. Clearing it changes nothing that is reachable: with no token
--    there is no link to redeem and no reservation to count, so the flag was
--    guarding a door that is not there. The order that was actually placed is
--    unaffected; it is linked through `converted_order_id`, not through this.
UPDATE "waitlist_entries"
SET "invite_used_at" = NULL
WHERE "invite_used_at" IS NOT NULL AND "invite_token" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_entries_invite_columns_together'
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_invite_columns_together" CHECK (
        ("invite_token" IS NULL) = ("invite_mode" IS NULL)
        AND ("invite_token" IS NULL) = ("invite_expires_at" IS NULL)
      );
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_entries_invite_used_implies_token'
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_invite_used_implies_token" CHECK (
        "invite_used_at" IS NULL OR "invite_token" IS NOT NULL
      );
  END IF;
END $$;
