"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Input, Notice } from "@/components/ui";
import { adminLogin, AdminApiError } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

/**
 * Admin sign-in.
 *
 * Reached by bookmark rather than by browsing, so it does not try to sell
 * anything — but it is the first screen of the panel and the only one outside
 * the `(panel)` layout, so it carries the panel's own furniture instead of
 * none: the ink wordmark block the rail wears, the same card and field chrome
 * as every form inside, and the same palette, which `admin/layout.tsx` has
 * already applied by the time this paints.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bg-page flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {/* The rail's lockup, standing on its own. This is the one screen with
            no sidebar to carry it, and an unbranded form on a warm ground
            reads as a stray page rather than the front door of the panel. */}
        {/* The border is doing real work in dark, where the rail and the page
            are within a hair of each other and the block would otherwise have
            no edge at all. */}
        <div className="bg-rail border-rail-rule rounded-container mb-6 border px-6 py-5 text-center">
          <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
          <p className="text-10 tracking-label text-rail-muted mt-1.5 uppercase">Admin</p>
        </div>

        <div className="rounded-container border-rule bg-surface border p-6">
          <h1 className="text-h3 text-ink font-serif">Sign in</h1>
          <p className="text-13.5 text-secondary mt-1">
            Staff access to orders, the catalog, and shop settings.
          </p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {/* `Notice` carries `role="alert"` on this tone, so a failed
                sign-in is announced and not only shown. */}
            {error ? <Notice tone="error">{error}</Notice> : null}

            <Button type="submit" block loading={loading} loadingLabel="Signing in">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
