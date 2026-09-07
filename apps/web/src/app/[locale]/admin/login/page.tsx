"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Input, Notice, PasswordInput } from "@/components/ui";
import { adminLogin, AdminApiError } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";
import { routes } from "@/lib/routes";

/**
 * Admin sign-in.
 *
 * Reached by bookmark rather than by browsing, so it does not try to sell
 * anything — but it is the first screen of the panel and the only one outside
 * the `(panel)` layout, so it carries the panel's own furniture instead of
 * none: the ink wordmark block the rail wears, the same card and field chrome
 * as every form inside, and the same palette, which `admin/layout.tsx` has
 * already applied by the time this paints.
 *
 * One card rather than two stacked blocks. The lockup used to float above the
 * form in a container of its own, centred over left-aligned fields — two
 * objects that had to be read as one, on two different axes. It is now the
 * card's masthead: the rail's colour along the top edge, the same left margin
 * as the heading and every label under it, so the eye goes down a single
 * column from wordmark to button without stepping sideways once.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Bumped on every rejection, and used as the `Notice`'s key.
   *
   * Two failed attempts in a row usually produce the *same* sentence, and a
   * `role="alert"` whose text has not changed is not re-announced — so the
   * second refusal was silent for a screen reader while being perfectly
   * visible to everyone else. Remounting the element makes it a new alert.
   */
  const [attempt, setAttempt] = useState(0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await adminLogin({ email, password });
      // The session itself lives in the httpOnly cookies the API just set —
      // this flag is only a client-side "did I sign in" hint so the protected
      // page knows to check, rather than always attempting a request. The
      // actual gate is the API's 401 on a missing/expired cookie.
      window.localStorage.setItem(ADMIN_AUTHED_KEY, "1");
      router.push(`/${locale}/admin`);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Sign-in failed.");
      setAttempt((count) => count + 1);
      setLoading(false);
      return;
    }

    /* Deliberately not in a `finally`: on success the router is already
       navigating, and dropping the button out of its loading state before the
       panel paints reads as "nothing happened" and invites a second click on a
       form that has already been accepted. */
  }

  return (
    <main className="bg-page flex min-h-screen flex-col items-center justify-center gap-5 px-6 py-16">
      {/* `overflow-hidden` is load-bearing: it is what clips the masthead's
          square corners to the container radius. */}
      <div className="rounded-container border-rule bg-surface w-full max-w-sm overflow-hidden border">
        {/* The rail's lockup, carried onto the one screen with no sidebar to
            carry it. An unbranded form on a warm ground reads as a stray page
            rather than the front door of the panel. */}
        <div className="bg-rail border-rail-rule border-b px-6 py-5">
          <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
          <p className="text-10 tracking-label text-rail-muted mt-1.5 uppercase">Admin</p>
        </div>

        <div className="p-6">
          <h1 className="text-h3 text-ink font-serif">Sign in</h1>
          <p className="text-13.5 text-secondary mt-1">
            Staff access to orders, the catalog, and shop settings.
          </p>

          {/* Above the fields, not above the button. A refusal is about the
              credentials, so it belongs where the eye lands before it reaches
              them again — and putting it here keeps it from shoving the submit
              button down the screen at the exact moment it is being aimed at.
              `Notice` carries `role="alert"` on this tone, so it is announced
              and not only shown. */}
          {error ? (
            <Notice key={attempt} tone="error" className="mt-5">
              {error}
            </Notice>
          ) : null}

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              /* The only field on a page reached deliberately: nothing is
                 scrolled past to get here, so focusing it steals nothing. */
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <PasswordInput
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Button type="submit" block loading={loading} loadingLabel="Signing in" className="mt-1">
              Sign in
            </Button>
          </form>
        </div>
      </div>

      {/* The way out. Staff arrive by bookmark, but a customer who follows a
          stale link lands here too, and a sign-in form with no exit is a dead
          end for the one person on it who has no account. */}
      <p className="text-caption text-secondary">
        {/* Hover colour comes from the global link rule (clay), which is the
            system's one accent doing the one thing it is for. */}
        <Link href={routes(locale).home}>Back to the shop</Link>
      </p>
    </main>
  );
}
