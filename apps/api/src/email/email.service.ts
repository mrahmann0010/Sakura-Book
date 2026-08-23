import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";
import { EmailNotConfiguredError, EmailSendFailedError } from "./email.errors";

export type EmailMessage = {
  to: string;
  /** Recipient display name, if known — shows up in the client's address book prompt. */
  toName?: string;
  subject: string;
  html: string;
};

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * A thin client for Brevo's transactional email API.
 *
 * Plain `fetch` against the REST endpoint rather than Brevo's SDK, for the
 * same reason StorageService talks to Supabase over `fetch` instead of its
 * SDK: the only operation this app needs is "send one templated email", and a
 * generated client's full contacts/campaigns/webhooks surface is not worth
 * the dependency.
 *
 * Generic on purpose — any future transactional email (a shipped notice, a
 * password reset) sends through this same `send`, not a copy of it.
 */
@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(message: EmailMessage): Promise<void> {
    const apiKey = this.config.get("EMAIL_SERVICE", { infer: true });
    const fromAddress = this.config.get("EMAIL_FROM_ADDRESS", { infer: true });
    const fromName = this.config.get("EMAIL_FROM_NAME", { infer: true });

    if (!apiKey || !fromAddress) throw new EmailNotConfiguredError();

    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromAddress, name: fromName },
        to: [{ email: message.to, name: message.toName }],
        subject: message.subject,
        htmlContent: message.html,
      }),
    });

    if (!response.ok) {
      throw new EmailSendFailedError(response.status, await response.text());
    }
  }
}
