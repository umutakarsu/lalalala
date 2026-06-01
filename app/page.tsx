import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-sm font-medium tracking-wide text-accent">SCOUT</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
        The recruiting OS that wires into your stack.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        A connection layer for Berlin tech. A recruiter posts a role, an agent
        shortlists candidates from your own user-graph (LinkedIn CSV imports,
        never scraped), and warm intros flow through bridges — who get paid 15%
        of the success fee when the candidate is placed.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/recruiter"
          className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90"
        >
          Open the pipeline
        </Link>
        <Link
          href="/recruiter/jobs/new"
          className="rounded-md border border-border px-4 py-2 font-medium hover:bg-card"
        >
          Post a job
        </Link>
      </div>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["Your graph, not a scrape", "Candidates come from contacts you imported — consent-first, GDPR-safe."],
          ["Warm intros via bridges", "A mutual connection forwards a genuine note. The bridge earns when it lands."],
          ["Wires into your stack", "n8n integrations are the moat: every ATS you connect is a switching cost."],
        ].map(([h, b]) => (
          <div key={h} className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-medium">{h}</h3>
            <p className="mt-1 text-sm text-muted">{b}</p>
          </div>
        ))}
      </section>

      <footer className="mt-20 border-t border-border pt-6 text-xs text-muted">
        {/* Required for a public German landing page — see README. */}
        <span>Berlin, DE</span>
        <span className="mx-2">·</span>
        <Link href="/impressum" className="hover:underline">Impressum</Link>
        <span className="mx-2">·</span>
        <Link href="/datenschutz" className="hover:underline">Datenschutzerklärung</Link>
      </footer>
    </main>
  );
}
