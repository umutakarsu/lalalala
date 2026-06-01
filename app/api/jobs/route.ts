import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fireNewJobShortlist } from "@/lib/n8n";
import { SUCCESS_FEE_RATE, type NewJobInput } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/jobs — create a job, then fire the new-job-shortlist n8n workflow.
// This is the seam between Next (sync CRUD) and n8n (async agent work):
// the job is persisted synchronously; the shortlist is a fire-and-forget
// follow-on whose failure never fails the request.
export async function POST(req: Request) {
  let body: NewJobInput;
  try {
    body = (await req.json()) as NewJobInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.client_id || typeof body.client_id !== "string") {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Best-effort: attribute the job to the signed-in recruiter if there's a
  // session. Falls back to any requester_id passed in the body.
  let requesterId: string | null = body.requester_id ?? null;
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (user?.id) requesterId = user.id;
  } catch {
    // unauthenticated / no Supabase configured — proceed with body value
  }

  // success fee defaults to 18% of the top of the salary band when present
  const successFee =
    body.success_fee_eur ??
    (body.salary_max_eur ? Math.round(body.salary_max_eur * SUCCESS_FEE_RATE) : null);

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      client_id: body.client_id,
      title: body.title,
      seniority: body.seniority ?? null,
      stack: body.stack ?? [],
      must_haves: body.must_haves ?? [],
      nice_to_haves: body.nice_to_haves ?? [],
      salary_min_eur: body.salary_min_eur ?? null,
      salary_max_eur: body.salary_max_eur ?? null,
      remote_policy: body.remote_policy ?? "hybrid",
      location_pref: body.location_pref ?? null,
      pitch: body.pitch ?? null,
      visibility: body.visibility ?? "private",
      success_fee_eur: successFee,
      created_by: requesterId,
    })
    .select("id, title")
    .single();

  if (error || !job) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create job" },
      { status: 500 },
    );
  }

  // Build the free-text goal the shortlist agent ranks against.
  const goalParts = [
    body.title,
    body.seniority,
    (body.stack ?? []).join(", "),
    (body.must_haves ?? []).join(", "),
    body.pitch,
  ].filter(Boolean);

  const shortlist = await fireNewJobShortlist({
    job_id: job.id,
    goal_text: goalParts.join(". "),
    requester_id: requesterId,
    count: 10,
  });

  return NextResponse.json({ job, shortlist }, { status: 201 });
}
