import Link from "next/link";
import { PIPELINE_STAGES, type PlacementStatus } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PlacementCard = {
  id: string;
  status: PlacementStatus;
  job_title: string | null;
  bridge_fee_eur: number | null;
};

// Best-effort load. The pipeline view is read-only in the MVP; placement
// transitions are driven by n8n workflows (Calendly, Stripe, etc.).
async function loadPipeline(): Promise<Record<string, PlacementCard[]>> {
  const byStage: Record<string, PlacementCard[]> = {};
  for (const s of PIPELINE_STAGES) byStage[s.key] = [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("placements")
      .select("id, status, bridge_fee_eur, jobs(title)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    for (const row of data ?? []) {
      const job = (row as { jobs?: { title?: string } | { title?: string }[] }).jobs;
      const job_title = Array.isArray(job) ? job[0]?.title ?? null : job?.title ?? null;
      const card: PlacementCard = {
        id: row.id as string,
        status: row.status as PlacementStatus,
        job_title,
        bridge_fee_eur: (row.bridge_fee_eur as number | null) ?? null,
      };
      (byStage[card.status] ??= []).push(card);
    }
  } catch {
    // No DB configured yet (or empty) — render empty columns. This is the
    // expected state on a fresh checkout.
  }
  return byStage;
}

export default async function RecruiterPipeline() {
  const byStage = await loadPipeline();
  const total = Object.values(byStage).reduce((n, c) => n + c.length, 0);

  return (
    <main className="px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted">
            {total === 0
              ? "No placements yet — post a job and the shortlist agent fills the first column."
              : `${total} placement${total === 1 ? "" : "s"} in flight.`}
          </p>
        </div>
        <Link
          href="/recruiter/jobs/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + New job
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => {
          const cards = byStage[stage.key] ?? [];
          return (
            <section
              key={stage.key}
              className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card/50"
            >
              <header className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-medium">{stage.label}</span>
                <span className="rounded bg-background px-1.5 text-xs text-muted">
                  {cards.length}
                </span>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted/60">—</p>
                ) : (
                  cards.map((c) => (
                    <article
                      key={c.id}
                      className="rounded-md border border-border bg-background p-2 text-sm"
                    >
                      <p className="font-medium">{c.job_title ?? "Untitled role"}</p>
                      {c.bridge_fee_eur != null && (
                        <p className="mt-1 text-xs text-muted">
                          bridge €{c.bridge_fee_eur.toLocaleString("de-DE")}
                        </p>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
