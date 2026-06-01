import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client.
 *
 * In production the reranker + intro-message drafter run *inside* the
 * new-job-shortlist n8n workflow (Anthropic node) — that keeps the slow LLM
 * call off the request path. This helper exists for local testing and for any
 * synchronous Next.js surface that wants to draft on demand.
 */

export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export type Candidate = {
  id: string;
  full_name: string | null;
  headline: string | null;
  current_title: string | null;
  current_company: string | null;
  location: string | null;
  rank?: number;
};

export type RerankedCandidate = {
  id: string;
  relevance_score: number; // 0-1
  reasoning: string;
  draft_message: string; // warm intro the bridge could forward
};

/**
 * Rerank a tsvector-matched shortlist with Claude and draft a warm intro per
 * candidate. Mirrors what the n8n Anthropic node does, so the prompt stays in
 * one reviewable place. Returns parsed JSON; throws on malformed output.
 */
export async function rerankShortlist(
  jobSummary: string,
  candidates: Candidate[],
): Promise<RerankedCandidate[]> {
  const client = getAnthropic();

  const system =
    "You are Scout's recruiting shortlist agent. You rerank candidates for a " +
    "role and draft a short, warm, non-salesy intro message that a mutual " +
    "connection (the bridge) could comfortably forward. The bridge must NOT " +
    "feel like they are doing recruiting — the message reads like a genuine " +
    "'you two should talk' note. Never invent facts about a candidate. " +
    'Respond ONLY with JSON: {"candidates":[{"id","relevance_score","reasoning","draft_message"}]}.';

  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system,
    messages: [
      {
        role: "user",
        content:
          `ROLE\n${jobSummary}\n\nCANDIDATES (JSON)\n` +
          JSON.stringify(candidates, null, 2) +
          `\n\nRank by genuine fit (relevance_score 0-1) and draft one intro per candidate.`,
      },
    ],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(extractJson(text)) as { candidates: RerankedCandidate[] };
  return parsed.candidates;
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return text.slice(start, end + 1);
}
