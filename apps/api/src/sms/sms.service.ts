import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";
import { SmsNotConfiguredError, SmsSendFailedError } from "./sms.errors";
import { SmsSettingsService } from "./sms-settings.service";

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

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        message,
        phoneNumbers: [to],
        ...(sim ? { simNumber: sim } : {}),
      }),
    });

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
    const message =
      language === "bn"
        ? `প্রিয় গ্রাহক, আমাদের সাথে থাকার জন্য ধন্যবাদ। আপনার বইটি অর্ডারের জন্য প্রস্তুত। অর্ডার নিশ্চিত করতে ${ttlHours} ঘণ্টার মধ্যে অর্ডার করুন: ${url}`
        : `Dear customer, thanks for supporting us. Your book is ready for order. To confirm your order, please place it within ${ttlHours} hours: ${url}`;

    await this.send(phone, message);
  }
}
