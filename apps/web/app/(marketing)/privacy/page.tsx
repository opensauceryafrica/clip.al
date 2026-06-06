import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'Privacy Policy' };

// TODO(@owner): replace placeholder copy after legal review. Confirm retention
// periods and data-processor list. See OPEN_QUESTIONS.md.
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="June 4, 2026">
      <p>
        This policy explains what clip.al collects and why. We aim to collect as little as possible.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account</strong>: your email address. We never store passwords — sign-in uses a
          one-time code.
        </li>
        <li>
          <strong>Links</strong>: the destination URL, creation time, and a hashed fingerprint of
          your browser’s user-agent for abuse prevention.
        </li>
        <li>
          <strong>Clicks</strong>: we record click events for analytics. We do <em>not</em> store
          raw IP addresses with clicks — only a salted, daily-rotating hash that becomes unlinkable
          over time. We derive coarse location (country/region/city) and device type from the
          request.
        </li>
      </ul>
      <h2>How we use it</h2>
      <p>
        To operate the Service, prevent abuse, scan destinations for safety, and show you analytics
        for links you own.
      </p>
      <h2>Sharing</h2>
      <p>
        We use Resend to deliver email, Cloudflare Turnstile to block bots, and Google Safe Browsing
        to check destinations. We don’t sell your data.
      </p>
      <h2>Retention</h2>
      <p>
        Raw IPs exist only transiently (in the click queue and short-lived sign-in records) and are
        not retained. Click analytics are retained for up to <strong>[RETENTION PERIOD]</strong>.
      </p>
      <h2>Your choices</h2>
      <p>
        You can delete your account from settings, which soft-deletes it and schedules a purge.
        Contact <strong>[CONTACT EMAIL]</strong> with privacy requests.
      </p>
    </LegalShell>
  );
}
