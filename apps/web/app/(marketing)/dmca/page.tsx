import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'DMCA Policy' };

// TODO(@owner): a valid DMCA policy requires a designated agent with a real name,
// physical address, and email. Fill these before relying on safe-harbor. See
// OPEN_QUESTIONS.md. This is placeholder copy only.
export default function DmcaPage() {
  return (
    <LegalShell title="DMCA Policy" updated="June 4, 2026">
      <p>
        clip.al respects intellectual property rights and responds to valid notices of claimed
        infringement under the Digital Millennium Copyright Act (or equivalent local law).
      </p>
      <h2>Submitting a notice</h2>
      <p>A complete notice must include:</p>
      <ul>
        <li>Identification of the copyrighted work claimed to be infringed.</li>
        <li>The specific clip.al short link(s) at issue.</li>
        <li>Your contact information.</li>
        <li>
          A statement that you have a good-faith belief the use is not authorized, and that the
          information is accurate and you are authorized to act.
        </li>
        <li>Your physical or electronic signature.</li>
      </ul>
      <h2>Designated agent</h2>
      <p>
        Send notices to our designated agent: <strong>[DMCA AGENT NAME]</strong>,{' '}
        <strong>[PHYSICAL ADDRESS]</strong>, <strong>[DMCA EMAIL]</strong>.
      </p>
      <h2>Counter-notice</h2>
      <p>
        If your link was disabled and you believe it was a mistake, you may submit a counter-notice
        to the same agent.
      </p>
      <h2>Repeat infringers</h2>
      <p>We terminate accounts of repeat infringers in appropriate circumstances.</p>
    </LegalShell>
  );
}
