#!/usr/bin/env bash
#
# Supabase -> self-hosted Postgres 18 (Coolify) data migration.
#
# Schema comes from Drizzle migrations, never from a schema dump. Only the
# `public` data is carried across.
#
# Usage:
#   export SUPABASE_URL_PG='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres'
#   export TARGET_URL_PG='postgresql://postgres:<pw>@<vps-host>:<public-port>/postgres'
#   scripts/migrate-to-coolify.sh schema   # drizzle-kit migrate against target
#   scripts/migrate-to-coolify.sh dump     # data-only dump from Supabase
#   scripts/migrate-to-coolify.sh restore  # load it into the target
#   scripts/migrate-to-coolify.sh verify   # row counts, both sides
#   scripts/migrate-to-coolify.sh compare  # row *contents*, both sides
#   scripts/migrate-to-coolify.sh reset    # wipe target, for the rehearsal -> cutover redo
#
# DUMP_FILE=~/sakura-cutover.dump scripts/migrate-to-coolify.sh dump   # a second dump
#
set -euo pipefail

DUMP_FILE="${DUMP_FILE:-$HOME/sakura-data.dump}"
API_DIR="${API_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || die "$1 is not set"; }

# pg_dump must not be older than the server it dumps *into* the format for.
# A PG 15 client writing a custom-format dump restored by an 18 pg_restore is
# fine; the failure people hit is the reverse, and the cheap guard is to
# require 18 on both.
check_client_version() {
  local v
  v="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
  [[ "$v" -ge 18 ]] || die "pg_dump is $v.x, need 18.x — brew install postgresql@18 and put it first on PATH"
}

# Every table the migrations create. Counting all of them rather than a chosen
# few, because the ones that would go missing quietly are exactly the ones
# nobody thinks to list.
TABLES=(admin_sessions admin_users audit_log authors book_authors
        book_categories book_reviews books categories coupons
        delivery_regions initial_reviews order_items order_status_history
        orders payment_verifications payments
        publishers shop_settings waitlist_entries)

counts() {
  local url="$1" sql=""
  for t in "${TABLES[@]}"; do
    # to_regclass keeps a table that does not exist on one side from aborting
    # the whole query — it reports 0 rather than erroring.
    sql+="${sql:+ union all }select '$t' as t, coalesce((select count(*) from \"$t\"),0) as n where to_regclass('public.$t') is not null"
  done
  psql "$url" -At -F$'\t' -c "$sql order by t"
}

# --- content comparison -------------------------------------------------
#
# Matching row counts only prove nothing went missing. They say nothing about
# a value that arrived changed — a timestamp rounded, a numeric coerced, a
# nullable column defaulted on the way in. So `compare` hashes every row on
# both sides and compares the hashes.
#
# The two servers must render values identically or the hashes differ for
# reasons that are not the data. PGOPTIONS pins the settings that affect how a
# row prints, on both connections.
COMPARE_PGOPTIONS="-c timezone=UTC -c datestyle=ISO,MDY -c extra_float_digits=3 -c bytea_output=hex -c intervalstyle=postgres"

cq() { PGOPTIONS="$COMPARE_PGOPTIONS" psql "$1" -At -F$'\t' -v ON_ERROR_STOP=1 -c "$2"; }

# Columns per table, sorted by name rather than taken in physical order.
# The two databases do not agree on physical order — `coming_soon` was added
# to books by hand on Supabase and by migration 0032 on the target — so
# ROW(t.*) would hash identical data differently.
compare_cols() {
  local in_list
  in_list="$(printf "'%s'," "${TABLES[@]}" | sed 's/,$//')"
  cq "$1" "select table_name, string_agg(quote_ident(column_name), ',' order by column_name)
           from information_schema.columns
           where table_schema='public' and table_name in ($in_list)
           group by table_name order by table_name"
}

# Sum of the first 32 bits of each row's md5. A sum because row order is not
# preserved across a dump and restore, and the checksum must not care.
compare_sums() {
  local url="$1" cols_file="$2" sql="" t c
  while IFS=$'\t' read -r t c; do
    sql+="${sql:+ union all }select '$t' as t, count(*) as n,
      coalesce(sum(('x'||substr(md5(ROW($c)::text),1,8))::bit(32)::bigint),0) as ck
      from \"$t\""
  done < "$cols_file"
  cq "$url" "$sql order by t"
}

case "${1:-}" in
  schema)
    need TARGET_URL_PG
    cd "$API_DIR"
    DATABASE_URL="$TARGET_URL_PG" \
    DIRECT_DATABASE_URL="$TARGET_URL_PG" \
    DATABASE_SSL=disable \
      npm run db:migrate
    ;;

  reset)
    # Wipe the target back to empty and rebuild it from the migrations.
    #
    # This exists for the rehearsal → cutover gap. A rehearsal load goes stale
    # the moment production takes another order, and testing against it also
    # leaves your own test rows behind. Both are fixed the same way: throw the
    # database away and redo `schema` + a fresh `dump` at cutover, rather than
    # trying to reconcile what is in there.
    #
    # Drops the schemas rather than TRUNCATE-ing tables, so a migration added
    # between rehearsal and cutover is genuinely exercised. `extensions` is
    # left alone — 0002 creates it IF NOT EXISTS, and pg_trgm has no data.
    need TARGET_URL_PG
    printf 'This DROPS ALL DATA in:\n  %s\nType the word yes to continue: ' \
      "${TARGET_URL_PG%%\?*}"
    read -r confirm
    [[ "$confirm" == "yes" ]] || die "aborted"
    psql "$TARGET_URL_PG" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL
    echo "target reset — run '$0 schema' next"
    ;;

  dump)
    check_client_version
    need SUPABASE_URL_PG
    [[ ! -e "$DUMP_FILE" ]] || die "$DUMP_FILE already exists — move it aside first"
    # --disable-triggers sidesteps FK ordering (needs superuser on restore,
    # which you have self-hosted). --schema=public keeps auth/storage/realtime
    # out; Drizzle's journal lives in the `drizzle` schema so it cannot clash.
    pg_dump --data-only --schema=public --no-owner --no-privileges \
            --disable-triggers -Fc -v \
            -f "$DUMP_FILE" "$SUPABASE_URL_PG"
    ls -lh "$DUMP_FILE"
    ;;

  restore)
    check_client_version
    need TARGET_URL_PG
    [[ -s "$DUMP_FILE" ]] || die "$DUMP_FILE missing or empty — run 'dump' first"
    # --single-transaction so a partial load rolls back rather than leaving
    # half the orders in place, which is the state that is hardest to reason
    # about afterwards.
    pg_restore --data-only --disable-triggers --no-owner --no-privileges \
               --single-transaction \
               -d "$TARGET_URL_PG" "$DUMP_FILE"
    ;;

  verify)
    need SUPABASE_URL_PG; need TARGET_URL_PG
    join -t$'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 \
      <(counts "$SUPABASE_URL_PG") <(counts "$TARGET_URL_PG") \
      | awk -F'\t' 'BEGIN{printf "%-22s %10s %10s  %s\n","table","supabase","target",""}
                    {printf "%-22s %10s %10s  %s\n",$1,$2,$3,($2==$3?"ok":"MISMATCH")}
                    $2!=$3{bad++}
                    END{if(bad){print "\n"bad" table(s) disagree"; exit 1} print "\nall match"}'
    ;;

  compare)
    need SUPABASE_URL_PG; need TARGET_URL_PG
    work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

    compare_cols "$SUPABASE_URL_PG" > "$work/cols.src"
    compare_cols "$TARGET_URL_PG"   > "$work/cols.dst"
    # A column present on one side only would make every row hash differ, which
    # reads as "all the data is wrong" when the real fault is one column.
    if ! diff -q "$work/cols.src" "$work/cols.dst" >/dev/null; then
      echo "column sets differ — fix the schema before reading the row hashes:"
      diff "$work/cols.src" "$work/cols.dst" || true
      echo
    fi

    compare_sums "$SUPABASE_URL_PG" "$work/cols.src" > "$work/ck.src"
    compare_sums "$TARGET_URL_PG"   "$work/cols.dst" > "$work/ck.dst"

    join -t$'\t' -a1 -a2 -e MISSING -o 0,1.2,1.3,2.2,2.3 "$work/ck.src" "$work/ck.dst" \
    | awk -F'\t' -v out="$work/mismatched" '
        BEGIN{printf "%-24s %8s %-16s %8s %-16s  %s\n","table","rows","checksum","rows","checksum","result"}
        {ok=($2==$4 && $3==$5)
         printf "%-24s %8s %-16s %8s %-16s  %s\n",$1,$2,$3,$4,$5,(ok?"ok":"MISMATCH")
         if(!ok){bad++; print $1 > out}}
        END{if(bad) printf "\n%d table(s) differ in content\n",bad
            else print "\nevery row matches on both sides"}'

    # Which rows, not just which tables. Hash each row keyed by its primary key
    # and diff the two sorted lists, so a mismatch names the offending ids
    # instead of leaving a table-sized haystack.
    [[ -s "$work/mismatched" ]] || exit 0
    # Read the list up front rather than looping over a redirected file: psql
    # inherits the loop's stdin and eats the remaining table names, so only the
    # first mismatch ever got drilled into.
    # Built with a read loop rather than mapfile — macOS ships bash 3.2.
    mismatched=()
    while IFS= read -r line; do mismatched+=("$line"); done < "$work/mismatched"
    for t in "${mismatched[@]}"; do
      c="$(grep -m1 "^$t"$'\t' "$work/cols.src" | cut -f2)"
      k="$(cq "$SUPABASE_URL_PG" "
        select string_agg(quote_ident(a.attname), ',' order by k.ord)
        from pg_index i
        join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where i.indrelid = 'public.$t'::regclass and i.indisprimary")"
      [[ -n "$k" ]] || { echo; echo "$t: no primary key, skipping row-level diff"; continue; }
      for side in src dst; do
        [[ "$side" == src ]] && u="$SUPABASE_URL_PG" || u="$TARGET_URL_PG"
        cq "$u" "select concat_ws('/', $k), md5(ROW($c)::text) from \"$t\" order by 1" \
          > "$work/rows.$side"
      done
      echo
      echo "=== $t: differing rows (< supabase only/changed, > target only/changed) ==="
      # `|| true` because a differing diff exits 1, and under `set -e` with
      # pipefail that ends the run after the first mismatched table — the one
      # case where you most want to see the rest.
      { diff "$work/rows.src" "$work/rows.dst" || true; } | grep -E '^[<>]' | head -40 || true
    done
    exit 1
    ;;

  *)
    die "usage: $0 {schema|dump|restore|verify|compare|reset}"
    ;;
esac
