import { env, isProd } from '@clipal/config';
import { Resend } from 'resend';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export const isEmailConfigured = resend !== null;

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a transactional email via Resend (the only external SaaS in Phase 1).
 * With no API key, log instead of sending so local development works without a
 * Resend account. In production, config refuses to boot without dependencies it
 * deems required — but RESEND_API_KEY is allowed empty, so guard at call sites
 * that truly need delivery.
 */
export async function sendEmail(opts: SendOptions): Promise<void> {
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY unset — would send "${opts.subject}" to ${opts.to} (not sent)`,
    );
    if (isProd) throw new Error('email not configured in production');
    return;
  }
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.text ? { text: opts.text } : {}),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
