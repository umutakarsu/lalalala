/**
 * n8n webhook helpers.
 *
 * Next.js owns synchronous request/response work; n8n owns everything async,
 * scheduled, or integration-shaped. The boundary is a webhook: a sync route
 * handler does its DB write, then fires-and-(soft)-forgets to n8n.
 *
 * Failure to reach n8n must never fail the user's request — the job is already
 * persisted; the shortlist is a follow-on. We log and move on.
 */

export type NewJobShortlistPayload = {
  job_id: string;
  /** Free-text goal handed to match_profiles (title + stack + must-haves + pitch). */
  goal_text: string;
  /** Recruiter profile id, excluded from matches and used as the bridge root. */
  requester_id: string | null;
  /** How many candidates the agent should shortlist. */
  count: number;
};

type FireResult = { ok: boolean; skipped?: boolean; status?: number; error?: string };

export async function fireNewJobShortlist(
  payload: NewJobShortlistPayload,
): Promise<FireResult> {
  const url = process.env.N8N_WEBHOOK_URL_NEW_JOB;
  if (!url) {
    console.warn(
      "[n8n] N8N_WEBHOOK_URL_NEW_JOB not set — skipping shortlist trigger for job",
      payload.job_id,
    );
    return { ok: false, skipped: true };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.N8N_WEBHOOK_SECRET) {
    headers["x-scout-signature"] = process.env.N8N_WEBHOOK_SECRET;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // never let a hung webhook hold the user's request hostage
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("[n8n] shortlist webhook returned", res.status);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[n8n] shortlist webhook failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
