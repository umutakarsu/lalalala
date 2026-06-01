import Link from "next/link";

// Datenschutzerklärung (GDPR privacy policy) is required for a public German
// site. Placeholder — needs a real policy + DPA before client onboarding.
export default function Datenschutz() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Datenschutzerklärung</h1>
      <p className="mt-4 text-sm text-muted">
        Placeholder privacy policy. Scout processes personal data of candidates
        and contacts; a full GDPR-compliant Datenschutzerklärung and a DPA
        (Auftragsverarbeitungsvertrag) template are launch blockers (see README).
      </p>
      <ul className="mt-6 list-disc space-y-2 pl-5 text-sm text-muted">
        <li>Candidate data is shared with clients only under live, explicit consent.</li>
        <li>Consent is rolling 90 days, auto-prompted to renew, and hard-deleted on expiry.</li>
        <li>Contacts are imported from user-provided LinkedIn CSVs — never scraped.</li>
        <li>Right to access, rectification, erasure, and data portability on request.</li>
      </ul>
      <p className="mt-8 text-sm">
        <Link href="/" className="text-accent hover:underline">← Back</Link>
      </p>
    </main>
  );
}
