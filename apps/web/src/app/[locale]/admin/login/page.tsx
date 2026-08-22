"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { adminLogin, AdminApiError } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

/**
 * Minimal admin sign-in. Functional, not polished — the first pass this
 * feature's admin surface gets (see AGENTS instructions for the pre-order
 * feature). Plain HTML form, no design-system chrome: this route is reached
 * by bookmark, not by browsing.
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
    <main style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>Admin sign in</h1>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

        <button type="submit" disabled={loading} style={{ padding: 10 }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
