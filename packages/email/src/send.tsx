import { isProd } from '@clipal/config';
import { render } from '@react-email/render';
import { isEmailConfigured, sendEmail } from './client';
import { AccountSuspended } from './templates/AccountSuspended';
import { LinkDisabled } from './templates/LinkDisabled';
import { SubscriptionReceipt } from './templates/SubscriptionReceipt';
import { VerificationCode } from './templates/VerificationCode';
import { WelcomeMigrated } from './templates/WelcomeMigrated';

export async function sendVerificationCode(
  to: string,
  opts: { code: string; city?: string | undefined; ip?: string | undefined },
): Promise<void> {
  // Local DX: surface the code in logs when email isn't wired up.
  if (!isEmailConfigured && !isProd) {
    console.info(`[email:dev] sign-in code for ${to}: ${opts.code}`);
  }
  const html = await render(
    <VerificationCode code={opts.code} city={opts.city} ip={opts.ip} expiresMinutes={10} />,
  );
  await sendEmail({ to, subject: `Your clip.al code: ${opts.code}`, html });
}

export async function sendWelcomeMigrated(to: string, dashboardUrl: string): Promise<void> {
  const html = await render(<WelcomeMigrated dashboardUrl={dashboardUrl} />);
  await sendEmail({ to, subject: 'Welcome back to clip.al', html });
}

export async function sendAccountSuspended(
  to: string,
  opts: { reason?: string | undefined; contactUrl: string },
): Promise<void> {
  const html = await render(
    <AccountSuspended reason={opts.reason} contactUrl={opts.contactUrl} />,
  );
  await sendEmail({ to, subject: 'Your clip.al account has been suspended', html });
}

export async function sendLinkDisabled(
  to: string,
  opts: { code: string; destination: string; threats: string[] },
): Promise<void> {
  const html = await render(
    <LinkDisabled code={opts.code} destination={opts.destination} threats={opts.threats} />,
  );
  await sendEmail({ to, subject: 'A clip.al link was disabled for safety', html });
}

/**
 * Format a minor-unit amount (kobo/cents) to a major-unit string with two
 * decimals, e.g. 250000 → "2,500.00". Pure string math (no Intl currency) to
 * stay deterministic across environments.
 */
function formatMinor(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const frac = Math.abs(amountMinor % 100)
    .toString()
    .padStart(2, '0');
  const grouped = whole.toLocaleString('en-US');
  return `${grouped}.${frac}`;
}

/**
 * Transactional subscription receipt. `amountMinor` is in the currency subunit
 * (kobo for NGN, cents for USD); `periodEnd` is the date access is paid through
 * (may be null for one-off charges with no period info).
 */
export async function sendSubscriptionReceipt(
  to: string,
  opts: { plan: string; amountMinor: number; currency: string; periodEnd: Date | null },
): Promise<void> {
  const amountMajor = formatMinor(opts.amountMinor);
  const periodEndLabel = opts.periodEnd
    ? opts.periodEnd.toISOString().slice(0, 10)
    : '—';
  const html = await render(
    <SubscriptionReceipt
      plan={opts.plan}
      amountMajor={amountMajor}
      currency={opts.currency}
      periodEndLabel={periodEndLabel}
    />,
  );
  await sendEmail({
    to,
    subject: `Your clip.al ${opts.plan} receipt — ${opts.currency} ${amountMajor}`,
    html,
  });
}
