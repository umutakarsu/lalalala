import Link from "next/link";

// Impressum is legally required for a public German site (§5 DDG / §18 MStV).
// Placeholder — fill with real provider details before going public.
export default function Impressum() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Impressum</h1>
      <p className="mt-4 text-sm text-muted">
        Angaben gemäß § 5 DDG. This is a placeholder — replace with the real legal
        entity, address, contact, and (if applicable) VAT ID before launch.
      </p>
      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="text-muted">Anbieter</dt>
          <dd>Scout (legal entity TBD)</dd>
        </div>
        <div>
          <dt className="text-muted">Kontakt</dt>
          <dd>hello@scout.example</dd>
        </div>
        <div>
          <dt className="text-muted">USt-IdNr.</dt>
          <dd>pending (Kleinunternehmer until €22k/yr — see README)</dd>
        </div>
      </dl>
      <p className="mt-8 text-sm">
        <Link href="/" className="text-accent hover:underline">← Back</Link>
      </p>
    </main>
  );
}
