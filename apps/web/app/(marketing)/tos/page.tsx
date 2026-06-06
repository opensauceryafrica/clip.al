import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = { title: 'Terms of Service' };

// TODO(@owner): replace placeholder copy after legal review. Blanks to fill:
// legal entity name, governing jurisdiction, contact email. See OPEN_QUESTIONS.md.
export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="June 4, 2026">
      <p>
        These Terms govern your use of clip.al (the “Service”), operated by{' '}
        <strong>[LEGAL ENTITY NAME]</strong> (“we”, “us”). By using the Service you agree to these
        Terms. If you don’t agree, don’t use the Service.
      </p>
      <h2>Using the Service</h2>
      <p>
        clip.al lets you shorten and manage links. You may use it anonymously or with an account.
        You are responsible for the links you create and the destinations they point to.
      </p>
      <h2>Acceptable use</h2>
      <p>
        You must follow our <a href="/aup">Acceptable Use Policy</a>. We may disable links, suspend
        accounts, and remove content that violates it or applicable law, with or without notice.
      </p>
      <h2>No warranty</h2>
      <p>
        The Service is provided “as is” without warranties of any kind. We don’t guarantee that any
        destination is safe; safety scanning is best-effort and not a substitute for your own
        judgment.
      </p>
      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we are not liable for indirect, incidental, or
        consequential damages arising from your use of the Service.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these Terms. Continued use after changes take effect constitutes acceptance.
      </p>
      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of <strong>[JURISDICTION]</strong>. Contact:{' '}
        <strong>[CONTACT EMAIL]</strong>.
      </p>
    </LegalShell>
  );
}
