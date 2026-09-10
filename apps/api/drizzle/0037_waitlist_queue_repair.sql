-- Make 0035 and 0036 true of this database, whatever it currently believes.
--
-- Joining the waitlist answered 500 in production while every read on the same
-- table worked. The cause is the shape of the statement rather than anything in
-- it: drizzle names *every* column of a table in an INSERT — supplying `default`
-- for the ones a caller left out — so an INSERT that mentions none of the queue
-- columns still fails with 42703 `undefined_column` when they are absent. Reads
-- name the columns they want, so the catalog, the invite lookup and the
-- reservation subquery all kept working and nothing pointed at the schema.
--
-- The columns were absent because 0035 and 0036 did not reach the database the
-- API connects to. Both possible reasons leave the same fingerprint and neither
-- is repaired by re-running them: either drizzle's bookkeeping already records
-- them as applied — which is what happens when a migration is applied by hand in
-- a container shell and marked, exactly the workflow 0033 and 0034 were written
-- to survive — or they were applied to a different database than the one
-- `DATABASE_URL` points at. A migration that has been recorded is never run
-- again; a new one always is. That is why this file exists rather than an edit
-- to those two.
--
-- So it re-states their objects, and every statement is guarded. On a database
-- that already has them this is a long no-op, which is the point: it has to be
-- safe to run everywhere, because it cannot be known from here which databases
-- need it.
--
-- What this deliberately does NOT do is drop or rewrite anything. If a column
-- exists with the wrong type, this leaves it alone and the drift check in
-- `db/migrate.ts` reports it rather than a migration silently reshaping a
-- production table.

-- 1. The release status enum (0035).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waitlist_allocation_status') THEN
    CREATE TYPE "public"."waitlist_allocation_status" AS ENUM('OPEN', 'CLOSED');
  END IF;
END $$;
--> statement-breakpoint

-- 2. Stock releases (0035). CREATE TABLE IF NOT EXISTS carries its own
--    constraints only when it actually creates the table; the FKs and indexes
--    below are therefore guarded separately, so a half-built table is completed
--    rather than left as it is.
CREATE TABLE IF NOT EXISTS "waitlist_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"copies" integer NOT NULL,
	"stock_snapshot" integer NOT NULL,
	"note" text,
	"status" "waitlist_allocation_status" DEFAULT 'OPEN' NOT NULL,
	"opened_by_id" uuid,
	"opened_by_email" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_allocations_copies_positive" CHECK ("waitlist_allocations"."copies" > 0),
	CONSTRAINT "waitlist_allocations_closed_columns_together" CHECK (("waitlist_allocations"."status" = 'CLOSED') = ("waitlist_allocations"."closed_at" is not null))
);
--> statement-breakpoint

-- 3. Invite waves (0036).
CREATE TABLE IF NOT EXISTS "waitlist_invite_waves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"wave_number" integer NOT NULL,
	"invited_count" integer NOT NULL,
	"invited_quantity" integer NOT NULL,
	"ttl_hours" integer NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"sent_by_id" uuid,
	"sent_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 4. The three columns on the entry — the ones the failing INSERT names.
ALTER TABLE "waitlist_entries" ADD COLUMN IF NOT EXISTS "invite_allocation_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN IF NOT EXISTS "invite_wave_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN IF NOT EXISTS "invite_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- 5. Foreign keys. Named exactly as 0035/0036 named them, including the
--    truncation Postgres applies to the allocation one — an identifier longer
--    than 63 characters is cut, and looking for the untruncated name would find
--    nothing and add the constraint a second time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_entries_invite_allocation_id_waitlist_allocations_id_fk', 63)
       AND conrelid = 'waitlist_entries'::regclass
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_invite_allocation_id_waitlist_allocations_id_fk"
      FOREIGN KEY ("invite_allocation_id") REFERENCES "public"."waitlist_allocations"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_entries_invite_wave_id_waitlist_invite_waves_id_fk', 63)
       AND conrelid = 'waitlist_entries'::regclass
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_invite_wave_id_waitlist_invite_waves_id_fk"
      FOREIGN KEY ("invite_wave_id") REFERENCES "public"."waitlist_invite_waves"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_allocations_book_id_books_id_fk', 63)
       AND conrelid = 'waitlist_allocations'::regclass
  ) THEN
    ALTER TABLE "waitlist_allocations"
      ADD CONSTRAINT "waitlist_allocations_book_id_books_id_fk"
      FOREIGN KEY ("book_id") REFERENCES "public"."books"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_allocations_opened_by_id_admin_users_id_fk', 63)
       AND conrelid = 'waitlist_allocations'::regclass
  ) THEN
    ALTER TABLE "waitlist_allocations"
      ADD CONSTRAINT "waitlist_allocations_opened_by_id_admin_users_id_fk"
      FOREIGN KEY ("opened_by_id") REFERENCES "public"."admin_users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_allocations_closed_by_id_admin_users_id_fk', 63)
       AND conrelid = 'waitlist_allocations'::regclass
  ) THEN
    ALTER TABLE "waitlist_allocations"
      ADD CONSTRAINT "waitlist_allocations_closed_by_id_admin_users_id_fk"
      FOREIGN KEY ("closed_by_id") REFERENCES "public"."admin_users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_invite_waves_allocation_id_waitlist_allocations_id_fk', 63)
       AND conrelid = 'waitlist_invite_waves'::regclass
  ) THEN
    ALTER TABLE "waitlist_invite_waves"
      ADD CONSTRAINT "waitlist_invite_waves_allocation_id_waitlist_allocations_id_fk"
      FOREIGN KEY ("allocation_id") REFERENCES "public"."waitlist_allocations"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = left('waitlist_invite_waves_sent_by_id_admin_users_id_fk', 63)
       AND conrelid = 'waitlist_invite_waves'::regclass
  ) THEN
    ALTER TABLE "waitlist_invite_waves"
      ADD CONSTRAINT "waitlist_invite_waves_sent_by_id_admin_users_id_fk"
      FOREIGN KEY ("sent_by_id") REFERENCES "public"."admin_users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- 6. The two CHECKs that pair a reference with a live token. Both are repaired
--    before being added, for the reason 0034 gives: a constraint cannot be added
--    over rows that already violate it, and a reference without a token is a
--    charge against a hold that does not exist.
UPDATE "waitlist_entries"
   SET "invite_allocation_id" = NULL, "invite_wave_id" = NULL
 WHERE "invite_token" IS NULL
   AND ("invite_allocation_id" IS NOT NULL OR "invite_wave_id" IS NOT NULL);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_entries_allocation_implies_token'
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_allocation_implies_token" CHECK (
        "invite_allocation_id" is null or "invite_token" is not null
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_entries_wave_implies_token'
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_wave_implies_token" CHECK (
        "invite_wave_id" is null or "invite_token" is not null
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_entries_invite_attempts_nonnegative'
  ) THEN
    ALTER TABLE "waitlist_entries"
      ADD CONSTRAINT "waitlist_entries_invite_attempts_nonnegative" CHECK (
        "invite_attempts" >= 0
      );
  END IF;
END $$;
--> statement-breakpoint

-- 7. Indexes. One open release per book is the rule the whole allocation design
--    rests on, so it matters that this one is really here and not merely
--    recorded as here.
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_allocations_open_per_book_idx"
  ON "waitlist_allocations" USING btree ("book_id")
  WHERE "waitlist_allocations"."status" = 'OPEN';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_allocations_book_id_idx"
  ON "waitlist_allocations" USING btree ("book_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_invite_waves_allocation_number_idx"
  ON "waitlist_invite_waves" USING btree ("allocation_id","wave_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_invite_waves_allocation_id_idx"
  ON "waitlist_invite_waves" USING btree ("allocation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_entries_invite_allocation_id_idx"
  ON "waitlist_entries" USING btree ("invite_allocation_id");
--> statement-breakpoint

-- 8. RLS, for the reason 0022 states: 0003 enabled it by looping over the tables
--    that existed then, so a table added later has to say so for itself. The
--    owning role bypasses it and FORCE is deliberately not set, so this changes
--    nothing for the API and remains the backstop if a privilege is ever granted
--    back to anon/authenticated.
ALTER TABLE "waitlist_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waitlist_invite_waves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- 9. The attempt-count backfill from 0036, which only ran where 0036 ran. It is
--    the fairness sort's key: left at 0, everyone already invited ties with
--    everyone who has never had a turn, and the first wave after this deploy
--    hands second chances out ahead of first ones. Restricted to rows still at
--    0 so it cannot overwrite a real count on a database where 0036 did run.
UPDATE "waitlist_entries"
   SET "invite_attempts" = 1
 WHERE "invite_attempts" = 0
   AND ("invite_token" IS NOT NULL OR "invite_sms_at" IS NOT NULL);
