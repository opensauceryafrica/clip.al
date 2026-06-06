import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'Acceptable Use Policy' };

// TODO(@owner): confirm the prohibited-use list and enforcement specifics.
export default function AupPage() {
  return (
    <LegalShell title="Acceptable Use Policy" updated="June 4, 2026">
      <p>This policy lists what you may not do with clip.al. It applies to everyone.</p>
      <h2>Prohibited links and destinations</h2>
      <ul>
        <li>Phishing, credential harvesting, or impersonation of a brand or person.</li>
        <li>Malware, exploits, or links that trigger unwanted downloads.</li>
        <li>Spam, deceptive redirects, or cloaking (showing different content to scanners).</li>
        <li>Child sexual abuse material, or any content illegal where you or your audience are.</li>
        <li>Links to other URL shorteners, redirect chains intended to evade safety checks.</li>
      </ul>
      <h2>Prohibited behavior</h2>
      <ul>
        <li>Circumventing rate limits, captchas, or safety scanning.</li>
        <li>Automated bulk creation without permission.</li>
        <li>Attacking the Service or other users.</li>
      </ul>
      <h2>Enforcement</h2>
      <p>
        We may disable links, move them to review, suspend accounts, and add domains to a blocklist.
        Serious or repeated violations may be reported to the appropriate authorities. To report
        abuse, use the report button on any interstitial page or contact{' '}
        <strong>[ABUSE EMAIL]</strong>.
      </p>
    </LegalShell>
  );
}
