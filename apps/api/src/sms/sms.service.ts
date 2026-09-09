import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";
import { SmsGatewayUnreachableError, SmsNotConfiguredError, SmsSendFailedError } from "./sms.errors";
import { SmsSettingsService } from "./sms-settings.service";
import { toE164Bd } from "./phone";

/**
 * A thin client for the Android SMS Gateway app (capcom6/android-sms-gateway)
 * — a phone running the gateway app stands in for a paid SMS provider.
 *
 * Works unmodified against either mode the app offers: point SMS_GATEWAY_URL
 * at the phone's local address (`http://<phone-ip>:8080/api/mobile/v1`) or at
 * the hosted cloud relay (`https://api.sms-gate.app/3rdparty/v1`) — both
 * expose the same `POST {base}/messages` shape behind HTTP Basic Auth, so
 * switching modes is a config change, not a code change.
 *
 * Generic on purpose, same reasoning as EmailService: any future text (an
 * invite link today, a shipping notice later) sends through this same `send`,
 * not a copy of it.
 */
@Injectable()
export class SmsService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly settings: SmsSettingsService,
  ) {}

  /**
   * @param simNumber Which SIM slot sends it (1-3), per the gateway's
   * `smsgateway.Message` schema. Omitted falls back to the shop's saved
   * setting (Shop Settings → SMS) so every caller sends from the same SIM
   * without having to know or pass it — and that setting, not this call, is
   * where "always use SIM 1" is decided.
   */
  async send(to: string, message: string, simNumber?: number): Promise<void> {
    const baseUrl = this.config.get("SMS_GATEWAY_URL", { infer: true });
    const username = this.config.get("SMS_GATEWAY_USERNAME", { infer: true });
    const password = this.config.get("SMS_GATEWAY_PASSWORD", { infer: true });

    if (!baseUrl || !username || !password) throw new SmsNotConfiguredError();

    const sim = simNumber ?? (await this.settings.simNumber()) ?? undefined;

    /* Bounded on purpose — see SMS_GATEWAY_TIMEOUT_MS. `fetch` waits forever
       by default, and forever is the one duration a caller sending to a batch
       of people cannot survive: the failure stops being "this text didn't go"
       and becomes "nothing after it was even attempted". */
    const timeoutMs = this.config.get("SMS_GATEWAY_TIMEOUT_MS", { infer: true });

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          message,
          // Normalised here, not by callers: the gateway takes E.164 only
          // and answers anything else with `400 invalid phone number`, while
          // the numbers we hold were typed freely at signup. See toE164Bd.
          phoneNumbers: [toE164Bd(to)],
          ...(sim ? { simNumber: sim } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      /* An aborted fetch rejects with a TimeoutError; a refused or dropped
         connection rejects with a bare TypeError. Both surface here as a
         DomainError rather than a raw fetch rejection, so a caller catching
         "the SMS didn't send" catches this too — an unwrapped TypeError
         escaping a best-effort send would take down the request around it. */
      const timedOut = error instanceof Error && error.name === "TimeoutError";

      throw new SmsGatewayUnreachableError(
        timedOut ? "timeout" : "network",
        error instanceof Error ? error.message : String(error),
        timeoutMs,
      );
    }

    if (!response.ok) {
      throw new SmsSendFailedError(response.status, await response.text());
    }
  }

  /**
   * Text a customer the link an invite token resolves to.
   *
   * Takes the finished URL rather than building one itself: this service
   * doesn't know the frontend's route for redeeming an invite (there's no
   * checkout page wired to WaitlistInviteService yet), so whichever flow
   * mints the token is what decides the URL — this only owns the wording.
   */
  async sendInviteLink(
    phone: string,
    url: string,
    language: "en" | "bn",
    ttlHours: number,
  ): Promise<void> {
    /* Both templates are short because an SMS is billed by segment, and the
       two languages do not get the same budget. English is GSM-7: 160
       characters. Bangla is UCS-2 — any Bangla character forces it — and
       that is 70 characters for the entire message, link included, counted
       by code point, so a conjunct like "প্রিয়" costs six.

       The previous wording opened with a greeting and a thank-you and then
       restated what the link is for. At 195 characters that was three billed
       segments per Bangla invite; this is one. The courtesy now lives on the
       page the link opens, where it costs nothing. */
    const message =
      language === "bn"
        ? `${ttlHours} ঘণ্টার মধ্যে বই অর্ডার করুন: ${url}`
        : `Order your book within ${ttlHours} hours: ${url}`;

    await this.send(phone, message);
  }
}
