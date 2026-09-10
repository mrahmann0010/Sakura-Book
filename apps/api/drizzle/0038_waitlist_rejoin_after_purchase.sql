-- Let someone who bought join the same book's queue again.
--
-- The uniqueness rule was (phone, book) with no opinion about status, so an
-- entry occupied its slot forever. The person that locked out was always the
-- same one: the customer who waited, answered the SMS and bought. Their own
-- purchase is what held the slot, so the first reprint of any title would have
-- turned away exactly the people who had already proved they wanted it — and
-- turned them away with "you're already on this list", which is the worst
-- available wording for a list they are no longer being served by.
--
-- CANCELLED keeps blocking, deliberately. Converting is the queue working;
-- cancelling is somebody asking to be taken off it, that request is meant to
-- stick, and Cancel is the only do-not-contact tool the shop has. See the
-- indexes' comment in `db/schema/marketing/waitlist-entry.ts`.
--
-- Rejoining is a new row rather than a reset of the old one, which needs no
-- migration but is the reason this is safe to run: `created_at` is the queue's
-- fairness key, so a returning customer starts at the back with
-- `invite_attempts` at zero, and the converted row stays as history.
--
-- Narrowing a partial index can never fail on existing data. The new predicate
-- indexes a strict subset of the rows the old one did — every CONVERTED row
-- leaves the index and none join it — so no duplicate can appear that was not
-- already there, and none was: the old index forbade them.
--
-- DROP ... IF EXISTS for the reason 0037 gives at length. This database's
-- migration history has been applied to more than one server, and a statement
-- that assumes what it will find is a statement that fails a deploy.

DROP INDEX IF EXISTS "waitlist_entries_phone_book_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "waitlist_entries_phone_general_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "waitlist_entries_phone_book_idx" ON "waitlist_entries" USING btree ("customer_phone","book_id") WHERE "waitlist_entries"."book_id" is not null and "waitlist_entries"."status" <> 'CONVERTED';--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_phone_general_idx" ON "waitlist_entries" USING btree ("customer_phone") WHERE "waitlist_entries"."book_id" is null and "waitlist_entries"."status" <> 'CONVERTED';
