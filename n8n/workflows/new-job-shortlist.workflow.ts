/**
 * Scout n8n workflow #2 — New Job Shortlist  (the most valuable flow)
 *
 * Source of truth for the workflow, kept in the repo so it is reviewable and
 * versioned. It is built/updated in n8n via the n8n MCP Workflow SDK tools
 * (validate_workflow → create_workflow_from_code / update_workflow), NOT by
 * importing this file directly.
 *
 * Live workflow id: bGT2PkJOgssFRLyq
 *
 * Flow:
 *   New Job Webhook (POST /webhook/new-job-shortlist, fired by POST /api/jobs)
 *     → Normalize Payload (Set)            unwrap body.* with defaults
 *     → Fetch Shortlist (Postgres)          match_profiles + lateral find_bridges
 *     → Bundle Candidates (Aggregate)       all rows → one item { candidates: [...] }
 *     → Rerank & Draft Intros (AI Agent)    Claude + structured output parser
 *     → Build Intro Rows (Code)             join agent results back to candidates
 *     → Write Suggested Intros (Postgres)   insert intros, status = 'suggested'
 *     → Notify Recruiter (Email, once)      "shortlist ready"
 *
 * Credentials to wire in n8n (placeholders are created on import):
 *   - Postgres  "Scout Supabase Postgres"  → Supabase db (db.<ref>.supabase.co, db user)
 *   - Anthropic "Anthropic"                → ANTHROPIC_API_KEY
 *   - SMTP      "Scout SMTP"               → transactional email (Resend/Postmark/SES)
 *
 * Webhook payload contract (from lib/n8n.ts → NewJobShortlistPayload):
 *   { job_id: string, goal_text: string, requester_id: string | null, count: number }
 */
import { workflow, node, trigger, languageModel, outputParser, newCredential, expr, placeholder } from '@n8n/workflow-sdk';

const newJobWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'New Job Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'new-job-shortlist',
      responseMode: 'onReceived',
    },
  },
  output: [
    { body: { job_id: '8f1c0b2a-0000-0000-0000-000000000001', goal_text: 'Senior Backend Engineer. Go, Postgres. 5+ yrs backend, EU work auth.', requester_id: '11111111-1111-1111-1111-111111111111', count: 10 } },
  ],
});

const normalizePayload = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalize Payload',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'f-job', name: 'job_id', value: expr('{{ $json.body?.job_id ?? $json.job_id }}'), type: 'string' },
          { id: 'f-goal', name: 'goal_text', value: expr('{{ $json.body?.goal_text ?? $json.goal_text }}'), type: 'string' },
          { id: 'f-req', name: 'requester_id', value: expr('{{ $json.body?.requester_id ?? $json.requester_id ?? "" }}'), type: 'string' },
          { id: 'f-count', name: 'count', value: expr('{{ $json.body?.count ?? $json.count ?? 10 }}'), type: 'number' },
        ],
      },
    },
  },
  output: [
    { job_id: '8f1c0b2a-0000-0000-0000-000000000001', goal_text: 'Senior Backend Engineer. Go, Postgres. 5+ yrs backend, EU work auth.', requester_id: '11111111-1111-1111-1111-111111111111', count: 10 },
  ],
});

const fetchShortlist = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Fetch Shortlist',
    parameters: {
      operation: 'executeQuery',
      query: "select c.id as candidate_id, c.full_name, c.headline, c.current_title, c.current_company, c.location, c.rank, b.bridge_id, b.bridge_name, b.bridge_score from match_profiles($1, nullif($2, '')::uuid, $3::int) c left join lateral find_bridges(c.id, nullif($2, '')::uuid, 1) b on true order by c.rank desc;",
      options: { queryReplacement: expr('{{ [$json.goal_text, $json.requester_id, $json.count] }}') },
    },
    credentials: { postgres: newCredential('Scout Supabase Postgres') },
  },
  output: [
    { candidate_id: '22222222-2222-2222-2222-222222222222', full_name: 'Jane Doe', headline: 'Staff Backend Engineer · Go · distributed systems', current_title: 'Staff Engineer', current_company: 'Acme', location: 'Berlin', rank: 0.42, bridge_id: '33333333-3333-3333-3333-333333333333', bridge_name: 'Max Mustermann', bridge_score: 0.56 },
  ],
});

const bundleCandidates = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Bundle Candidates',
    parameters: {
      aggregate: 'aggregateAllItemData',
      destinationFieldName: 'candidates',
      include: 'allFields',
    },
  },
  output: [
    { candidates: [{ candidate_id: '22222222-2222-2222-2222-222222222222', full_name: 'Jane Doe', current_title: 'Staff Engineer', current_company: 'Acme', location: 'Berlin', rank: 0.42, bridge_id: '33333333-3333-3333-3333-333333333333', bridge_name: 'Max Mustermann' }] },
  ],
});

const claudeModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.5,
  config: {
    name: 'Claude Model',
    parameters: {
      model: { __rl: true, mode: 'list', value: 'claude-sonnet-4-6', cachedResultName: 'Claude Sonnet 4.6' },
      options: { maxTokensToSample: 2048, temperature: 0.2 },
    },
    credentials: { anthropicApi: newCredential('Anthropic') },
  },
});

const shortlistParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Shortlist Schema',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "results": [ { "candidate_id": "22222222-2222-2222-2222-222222222222", "relevance_score": 0.92, "reasoning": "Direct match on Go + distributed systems at scale.", "draft_message": "Hi Max — I think you know Jane. Mind connecting us? Happy to share why." } ] }',
    },
  },
});

const rerankAndDraft = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Rerank & Draft Intros',
    parameters: {
      promptType: 'define',
      hasOutputParser: true,
      text: expr('ROLE\n{{ $("Normalize Payload").item.json.goal_text }}\n\nCANDIDATES (JSON array; each has candidate_id and possibly a bridge_name)\n{{ JSON.stringify($json.candidates) }}\n\nRerank by genuine fit. For each candidate you keep, return a 0-1 relevance_score, a one-line reasoning, and a short warm intro draft the bridge could forward.'),
      options: {
        systemMessage: "You are Scout's recruiting shortlist agent. You rerank candidates for a role and draft a short, warm, non-salesy intro message that a mutual connection (the bridge) could comfortably forward. The bridge must NOT feel like they are doing recruiting work — the note reads like a genuine \"you two should talk\" message and never mentions a fee or a job posting. Never invent facts about a candidate; only use the fields provided. Address the bridge by bridge_name when present. Return only the structured JSON.",
      },
    },
    subnodes: { model: claudeModel, outputParser: shortlistParser },
  },
  output: [
    { output: { results: [{ candidate_id: '22222222-2222-2222-2222-222222222222', relevance_score: 0.92, reasoning: 'Direct match on Go + distributed systems.', draft_message: 'Hi Max — I think you know Jane Doe. Would you be open to a quick intro? Happy to explain why.' }] } },
  ],
});

const buildIntroRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Intro Rows',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const agentOut = $('Rerank & Draft Intros').first().json.output || {};\nconst results = Array.isArray(agentOut.results) ? agentOut.results : [];\nconst shortlist = $('Fetch Shortlist').all().map(i => i.json);\nconst norm = $('Normalize Payload').first().json;\nconst byId = {};\nfor (const c of shortlist) { byId[c.candidate_id] = c; }\nconst rows = [];\nfor (const r of results) {\n  const c = byId[r.candidate_id];\n  if (!c) { continue; }\n  rows.push({ json: {\n    requester_id: norm.requester_id || null,\n    bridge_id: c.bridge_id || null,\n    target_profile_id: r.candidate_id,\n    job_id: norm.job_id,\n    status: 'suggested',\n    goal: norm.goal_text,\n    context: r.reasoning || null,\n    draft_message: r.draft_message || null,\n    relevance_score: (r.relevance_score === undefined || r.relevance_score === null) ? null : r.relevance_score\n  } });\n}\nreturn rows;",
    },
  },
  output: [
    { requester_id: '11111111-1111-1111-1111-111111111111', bridge_id: '33333333-3333-3333-3333-333333333333', target_profile_id: '22222222-2222-2222-2222-222222222222', job_id: '8f1c0b2a-0000-0000-0000-000000000001', status: 'suggested', goal: 'Senior Backend Engineer. Go, Postgres.', context: 'Direct match on Go.', draft_message: 'Hi Max — I think you know Jane Doe...', relevance_score: 0.92 },
  ],
});

const writeIntros = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Write Suggested Intros',
    parameters: {
      operation: 'insert',
      schema: { __rl: true, mode: 'name', value: 'public' },
      table: { __rl: true, mode: 'name', value: 'intros' },
      columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] },
    },
    credentials: { postgres: newCredential('Scout Supabase Postgres') },
  },
  output: [
    { id: '44444444-4444-4444-4444-444444444444', status: 'suggested' },
  ],
});

const notifyRecruiter = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Notify Recruiter',
    executeOnce: true,
    parameters: {
      operation: 'send',
      fromEmail: placeholder('Scout sender address, e.g. scout@yourdomain.com'),
      toEmail: placeholder('Recruiting inbox to notify, e.g. team@yourdomain.com'),
      subject: expr("Shortlist ready — {{ $('Build Intro Rows').all().length }} candidate(s)"),
      emailFormat: 'html',
      html: expr("<p>The shortlist agent suggested {{ $('Build Intro Rows').all().length }} candidate(s) for job {{ $('Normalize Payload').item.json.job_id }}.</p><p>Open the Scout pipeline and review the <strong>Suggested</strong> column.</p>"),
      options: { appendAttribution: false },
    },
    credentials: { smtp: newCredential('Scout SMTP') },
  },
  output: [
    { messageId: '<generated>', accepted: ['team@yourdomain.com'] },
  ],
});

export default workflow('new-job-shortlist', 'New Job Shortlist')
  .add(newJobWebhook)
  .to(normalizePayload)
  .to(fetchShortlist)
  .to(bundleCandidates)
  .to(rerankAndDraft)
  .to(buildIntroRows)
  .to(writeIntros)
  .add(buildIntroRows)
  .to(notifyRecruiter);
