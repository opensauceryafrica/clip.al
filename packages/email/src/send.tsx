import { isProd } from '@clipal/config';
import { render } from '@react-email/render';
import { isEmailConfigured, sendEmail } from './client';
import { AccountSuspended } from './templates/AccountSuspended';
import { LinkDisabled } from './templates/LinkDisabled';
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
