// Shared domain types + constants for the UI and route handlers.

export type RemotePolicy = "onsite" | "hybrid" | "remote";
export type JobStatus = "open" | "paused" | "filled";
export type JobVisibility = "public" | "private";

export type PlacementStatus =
  | "suggested"
  | "bridge_asked"
  | "bridge_accepted"
  | "candidate_pitched"
  | "interested"
  | "intro_call_booked"
  | "interviewing"
  | "offer_extended"
  | "accepted"
  | "started"
  | "invoiced"
  | "paid"
  | "dropped"
  | "refunded";

/** Ordered, non-terminal stages shown as kanban columns. */
export const PIPELINE_STAGES: { key: PlacementStatus; label: string }[] = [
  { key: "suggested", label: "Suggested" },
  { key: "bridge_asked", label: "Bridge asked" },
  { key: "bridge_accepted", label: "Bridge accepted" },
  { key: "candidate_pitched", label: "Candidate pitched" },
  { key: "interested", label: "Interested" },
  { key: "intro_call_booked", label: "Intro call booked" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer_extended", label: "Offer extended" },
  { key: "accepted", label: "Accepted" },
  { key: "started", label: "Started" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
];

/** Pricing model — kept in sync with the DB defaults in 0002_recruiting.sql. */
export const SUCCESS_FEE_RATE = 0.18; // of first-year gross comp
export const BRIDGE_FEE_RATE = 0.15; // of the success fee
export const REPLACEMENT_GUARANTEE_DAYS = 90;

/** Shape posted by the "new job" form to POST /api/jobs. */
export type NewJobInput = {
  client_id: string;
  title: string;
  seniority?: string;
  stack?: string[];
  must_haves?: string[];
  nice_to_haves?: string[];
  salary_min_eur?: number | null;
  salary_max_eur?: number | null;
  remote_policy?: RemotePolicy;
  location_pref?: string;
  pitch?: string;
  visibility?: JobVisibility;
  success_fee_eur?: number | null;
  /** Recruiter profile id (bridge root + match exclusion). Optional in MVP. */
  requester_id?: string | null;
};
