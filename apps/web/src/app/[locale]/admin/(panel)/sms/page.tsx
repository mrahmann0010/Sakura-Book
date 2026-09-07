"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Button, Input, Notice, Textarea, Toast } from "@/components/ui";
import { AdminApiError, sendAdminSms } from "@/lib/api/admin";

/**
 * The whole feature: a phone number, a message, a Send button. Fires through
 * SmsService on the API side, which talks to whatever the gateway currently
 * points at (android-sms-gateway today) — nothing here knows or cares which
 * provider is behind it, and which SIM it sends from is configured once in
 * Shop Settings → SMS rather than chosen again on every message.
 */
export default function AdminSmsPage() {
  const { locale } = useParams<{ locale: string }>();

  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);

    try {
      await sendAdminSms({ to, message });
      setToast(`Sent to ${to}.`);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex max-w-xl flex-col gap-6">
        <h1 className="text-h2 text-ink font-serif">Send SMS</h1>

        <p className="text-13.5 text-secondary">
          Sends one text through the configured SMS gateway. Enter the number exactly as the gateway
          expects it (e.g. with the country code) — nothing here reformats it. Which SIM it sends
          from is set in{" "}
          <Link href={`/${locale}/admin/settings/sms`} className="text-clay underline">
            Shop Settings → SMS
          </Link>
          .
        </p>

        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Input
            label="Phone number"
            placeholder="+8801XXXXXXXXX"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          />

          <Textarea
            label="Message"
            placeholder="Write the message to send"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            maxLength={1000}
            required
          />

          {error ? <Notice tone="error">{error}</Notice> : null}

          <Button
            type="submit"
            size="sm"
            disabled={sending || !to.trim() || !message.trim()}
            className="self-start"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </form>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-8">
          <div className="shell flex justify-center">
            <Toast className="max-w-measure pointer-events-auto shadow-lg">{toast}</Toast>
          </div>
        </div>
      ) : null}
    </>
  );
}
