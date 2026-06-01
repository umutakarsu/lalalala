"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUCCESS_FEE_RATE, type RemotePolicy } from "@/lib/types";

function toList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function NewJobPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // suggested success fee preview based on top of salary band
  const [salaryMax, setSalaryMax] = useState<string>("");
  const suggestedFee = salaryMax
    ? Math.round(Number(salaryMax) * SUCCESS_FEE_RATE)
    : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDone(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      client_id: String(fd.get("client_id") || "").trim(),
      title: String(fd.get("title") || "").trim(),
      seniority: String(fd.get("seniority") || "").trim() || undefined,
      stack: toList(String(fd.get("stack") || "")),
      must_haves: toList(String(fd.get("must_haves") || "")),
      nice_to_haves: toList(String(fd.get("nice_to_haves") || "")),
      salary_min_eur: fd.get("salary_min_eur") ? Number(fd.get("salary_min_eur")) : null,
      salary_max_eur: fd.get("salary_max_eur") ? Number(fd.get("salary_max_eur")) : null,
      remote_policy: (String(fd.get("remote_policy") || "hybrid") as RemotePolicy),
      location_pref: String(fd.get("location_pref") || "").trim() || undefined,
      pitch: String(fd.get("pitch") || "").trim() || undefined,
      visibility: (String(fd.get("visibility") || "private") as "public" | "private"),
    };

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      setDone(json.job?.id ?? "created");
      // give the user a beat to see the confirmation, then go to the pipeline
      setTimeout(() => router.push("/recruiter"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Post a job</h1>
      <p className="mt-1 text-sm text-muted">
        On create, the shortlist agent runs in n8n and the first candidates land
        in <span className="text-foreground">Suggested</span>.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-5">
        <Field label="Client ID" hint="UUID of the client row this job belongs to">
          <input name="client_id" required className={inputCls} placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>

        <Field label="Title" hint="e.g. Senior Backend Engineer">
          <input name="title" required className={inputCls} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Seniority">
            <input name="seniority" className={inputCls} placeholder="Senior / Staff / Lead" />
          </Field>
          <Field label="Remote policy">
            <select name="remote_policy" defaultValue="hybrid" className={inputCls}>
              <option value="onsite">Onsite</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
            </select>
          </Field>
        </div>

        <Field label="Stack" hint="comma or newline separated">
          <input name="stack" className={inputCls} placeholder="Go, Postgres, Kubernetes" />
        </Field>

        <Field label="Must-haves" hint="comma or newline separated">
          <textarea name="must_haves" rows={2} className={inputCls} placeholder="5+ yrs backend, EU work authorization" />
        </Field>

        <Field label="Nice-to-haves" hint="comma or newline separated">
          <textarea name="nice_to_haves" rows={2} className={inputCls} placeholder="fintech, German" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Salary min (€)">
            <input name="salary_min_eur" type="number" min={0} className={inputCls} />
          </Field>
          <Field label="Salary max (€)">
            <input
              name="salary_max_eur"
              type="number"
              min={0}
              className={inputCls}
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
            />
          </Field>
        </div>

        {suggestedFee != null && (
          <p className="-mt-2 text-xs text-muted">
            Suggested success fee (18% of top of band):{" "}
            <span className="text-foreground">€{suggestedFee.toLocaleString("de-DE")}</span>
          </p>
        )}

        <Field label="Location preference">
          <input name="location_pref" className={inputCls} placeholder="Berlin" />
        </Field>

        <Field label="Pitch (markdown)">
          <textarea name="pitch" rows={4} className={inputCls} placeholder="Why a great engineer should care about this role." />
        </Field>

        <Field label="Visibility">
          <select name="visibility" defaultValue="private" className={inputCls}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </Field>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {done && <p className="text-sm text-green-400">Job created — running the shortlist agent…</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create job"}
          </button>
        </div>
      </form>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {hint && <span className="ml-2 font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
