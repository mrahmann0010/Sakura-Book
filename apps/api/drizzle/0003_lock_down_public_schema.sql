-- Close the PostgREST door.
--
-- Supabase serves the `public` schema over PostgREST to anyone holding the
-- project's anon key — a credential that is published in browser bundles by
-- design. Supabase also grants `anon` and `authenticated` access to objects in
-- `public` through ALTER DEFAULT PRIVILEGES, and tables created by a migration
-- (rather than through the dashboard) have no row-level security enabled.
--
-- Those three facts compose into: every table in this schema is world-readable
-- and world-writable over HTTP without touching the API. `orders` alone carries
-- customer names, emails, phone numbers and addresses.
--
-- Nothing in this application wants that. The web app talks to the Nest API and
-- only to the Nest API; Supabase is a managed Postgres here, not a backend. So
-- this migration removes the exposure at both layers — privileges, and RLS as
-- the backstop if a privilege is ever granted back by hand or by a dashboard
-- action nobody remembers taking.
--
-- Guarded on the roles existing, so the same migration applies to a plain
-- Postgres that has never heard of `anon`.

DO $$
DECLARE
  target_role text;
  affected_table text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      CONTINUE;
    END IF;

    -- Existing objects.
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target_role);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target_role);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target_role);
    -- Without this the role can still see the schema and enumerate its tables.
    EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', target_role);

    -- Future objects. The default privileges are what would otherwise re-expose
    -- the next table someone adds, which is the failure mode this file exists
    -- to prevent: a migration written months from now, by someone who never
    -- read this comment, silently publishing a new table.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      target_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
      target_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
      target_role
    );
  END LOOP;

  -- RLS on every table, with no policies: deny by default.
  --
  -- This does not affect the API. The role that owns these tables — the one the
  -- migrations and the application connect as — bypasses RLS, because ownership
  -- bypasses it unless FORCE ROW LEVEL SECURITY is set, and it deliberately is
  -- not. So this is purely a backstop against a *different* role reaching the
  -- data, which is exactly the anon/authenticated case above.
  --
  -- It also silences Supabase's own "RLS disabled in public" advisor warning,
  -- which would otherwise sit permanently in the dashboard and train whoever
  -- reads it to ignore that warning class.
  FOR affected_table IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', affected_table);
  END LOOP;
END
$$;
