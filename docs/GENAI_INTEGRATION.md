# GenAI / MSS Integration Plan

Planning notes for the CDAO request to connect DonDocs with the Marine Corps
GenAI stack (GenAI.mil agents and/or HQMC Maven Smart System). Nothing here is
committed to yet — this is the scoping doc that turns a vague ask into a
buildable sequence.

Status: **discovery**. No code written against this yet.

---

## The ask

From Maj Byers (Deputy Director / Technical Lead, CDAO, DC CD&I):

> I am working some information/point paper "agents" in GenAI and a skill.md for
> Foundry/MSS to help users curate the required information and context, red team
> the brainstorming of a info/point paper, and generate a draft to a .docx.
> Any chance you're willing integrate the GenAi API to have a "clippy" like buddy
> to help you draft these types of documents.

Follow-up question that reframes it: *"is there an endpoint you can generate a
doc on?"*

Those two are **different integrations pointing opposite directions**. Pinning
down which one he wants is the first task (see Phase 0).

---

## What the platforms actually are

| Term | What it is |
|---|---|
| **GenAI.mil** | DoD enterprise GenAI platform, stood up by CDAO 9 Dec 2025. Unclassified/CUI only. Marine Corps has designated it their enterprise GenAI platform. Backed by Gemini for Government (plus xAI / OpenAI / Anthropic under CDAO contracts). |
| **Agent Designer** | GenAI.mil's no-/low-code agent builder. Natural language, no programming. |
| **Managed agents** | The developer path. Agent behavior defined in markdown (`AGENTS.md` / `SKILL.md`) and registered; the platform handles reasoning/tools/sandbox behind a single endpoint. This is what "a skill.md" refers to. |
| **MSS (Maven Smart System)** | Palantir's DoD platform, built on Foundry + AIP. HQMC has an instance. |
| **Foundry AIP agents** | Session-based REST: create session, then blocking or streaming continue. Auth via Developer Console SDK app, agent addressed by `agentRid`. TypeScript + Python SDKs exist. |

Relevant capability: Gemini managed agents support **remote MCP**, so "expose
DonDocs as a tool the agent can call" is a supported pattern, not a hack.

---

## Where DonDocs actually stands (verified in-repo)

**There is no backend.** No `server/`, `api/`, or `functions/` directory, no
Express/Fastify/Next, no serve script. DonDocs is a client-side offline PWA.

**Document generation runs in the browser:**

- Letters/memos: content → flat LaTeX → **pandoc WASM** → `.docx` Blob
  (`src/services/docx/pandoc-converter.ts`), and → **SwiftLaTeX** → PDF.
- Forms: values → **pdf-lib** overlay onto flattened template pages
  (`src/services/pdf/genericFormRenderer.ts`).

**The pandoc engine is already vendored same-origin** (from the air-gap work),
so it is not tied to a CDN — it just currently loads its assets via `fetch()`
against `window.location.origin`.

**~20 correspondence types exist** (naval letter, standard/business/joint
letters, endorsements, MFR, several memoranda, executive correspondence).
**There is no information paper or point paper type.** Closest is
`information_memorandum`.

**No outbound network calls exist today.** Every `fetch()` targets same-origin
bundled assets. Adding *any* external API call is the first one — that is an
architectural decision, not just a feature, because the app advertises
air-gap/offline operation on SIPR/JWICS.

---

## The two directions

### Direction A — DonDocs calls GenAI ("clippy" in the app)

The assistant lives inside DonDocs. A side panel talks to the GenAI.mil / MSS
agent, helps curate context, red-teams the draft, and fills the editor.

- Matches the literal wording of the email.
- Requires DonDocs to reach the agent API → auth, network, enclave.
- Puts an outbound dependency inside an app whose headline promise is offline
  operation. Must be feature-flagged and degrade cleanly when unreachable.

### Direction B — GenAI calls DonDocs (DonDocs as a tool/endpoint)

The agent does the drafting and red-teaming (that is what it is for), then calls
DonDocs to render the result into a correctly formatted `.docx`.

- Matches the "is there an endpoint" question.
- **Better architectural fit.** The LLM does prose; DonDocs does deterministic
  formatting. No tokens spent making a model emit DOCX/LaTeX byte by byte.
- Answers the "MCPs don't scale" concern: this is **one deterministic action**
  (structured content in → formatted document out), not a sprawling tool surface.
  It can be exposed as a single registered function/action *or* a lean 2–3 tool
  MCP server. Tool-count pressure comes from kitchen-sink agents, not from one
  small deterministic tool.

### Recommendation

**Build B first, treat A as optional follow-on.** B is smaller, safer, doesn't
compromise the offline story (the browser app is untouched), and is the piece
that actually unlocks his agent. A can be layered later if there's appetite.

---

## Plan

### Phase 0 — Discovery (blocking; cheap)

Nothing gets built correctly until these are answered.

1. Read the shared GenAI agent + `SKILL.md` + example output. Determine:
   - Does the agent expect to **call a tool**, or is DonDocs expected to call it?
   - What is the handoff shape for "generate a draft to .docx" — structured
     fields, or freeform markdown?
2. Get the **GenAI.mil / MSS developer docs and access**. The public docs cover
   the commercial Gemini/Foundry APIs; they say nothing about the .mil-specific
   endpoint, auth, or whether an *external* app may call an agent at all.
3. Confirm: **can integrations live outside the platform**, or must they run
   inside GenAI.mil / Maven? This is make-or-break. If integrations must live
   inside, this stops being "add an endpoint to DonDocs" and becomes "port the
   DonDocs drafting UX onto their platform" — a materially different project.
4. Auth model: CAC/PIV, API key, OAuth via Developer Console?
5. Which network / impact level, and what hosting is available there?

### Phase 1 — Information / point paper document type

**Do this regardless of direction, and do it first.** It has zero dependency on
their access, it's useful to Marines on its own, and it de-risks everything
downstream by settling the output format before any integration exists.

- New doc types: `information_paper`, `point_paper`.
- Section model (background / discussion / recommendation, per HQMC practice —
  needs a real format reference, same rigor as the SECNAV work).
- Wire into `DOC_TYPE_CONFIG`, `DOC_TYPE_LABELS`, `DOC_TYPE_CHIP`, the editor
  section list, and the DOCX layout.
- Verify by rendering a real `.docx`, not by asserting on source strings.

### Phase 2 — Headless render service

Wrap the existing generator in a small stateless HTTP service.

```
POST /generate
  { "docType": "point_paper", "content": { ...structured sections... } }
  -> 200 application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

Scope of work — this is a **shim, not a rewrite**:

- The doc assembly logic is plain TypeScript and already portable.
- pandoc WASM runs fine under Node; what's browser-specific is *asset loading*
  (`fetch()` + `window.location.origin`) — swap for filesystem reads.
- JSZip already works in Node.
- Stateless, no auth of its own initially, no persistence.

Keep it a **separate entry point**. The browser app must not gain a server
dependency — the offline PWA keeps generating documents locally exactly as it
does now.

### Phase 3 — Expose to the agent

Whichever the platform prefers:

- **Single function/action** registered with the agent (leanest), or
- **Small MCP server** exposing ~2–3 tools:
  `list_document_types`, `generate_document`, maybe `validate_format`.

Deliberately keep the tool surface tiny — that is the answer to the MCP scaling
concern.

### Phase 4 — Optional: in-app assistant (Direction A)

Only if wanted after B lands.

- Feature-flagged; **off by default**.
- Detects reachability; when the agent is unreachable the app behaves exactly as
  it does today. The air-gap claim must remain true for the offline build.
- Side panel: curate context → red-team → draft into the editor.

---

## Sizing

Assumes the Phase 0 answers are favorable (a reachable API / hostable service).

| Phase | Work | Estimate |
|---|---|---|
| 0 | Discovery, access, read their agent + skill.md | 2–4 days (mostly waiting on access) |
| 1 | Info/point paper doc type + DOCX layout | 3–5 days |
| 2 | Headless `POST /generate` service | ~1 week |
| 3 | Agent tool / MCP exposure + integration test | 3–5 days |
| 4 | In-app assistant (optional) | 1–2 weeks |

**Demo-able (Phases 1–3): ~2–3 weeks.**
**Polished v1 including the in-app assistant: ~4–6 weeks.**

Biggest swing factor is Phase 0, not the code.

---

## Risks and open questions

| Risk | Notes |
|---|---|
| **Integrations may have to live inside the platform** | Would invalidate the plan above. Highest-priority unknown. |
| **Air-gap promise** | Non-negotiable for the offline build. Any outbound call is feature-flagged and degrades cleanly. Direction B avoids this entirely. |
| **Hosting** | A headless service needs somewhere to run that the agent can reach, on the right network/IL. Unowned today. |
| **CUI handling** | Document content sent to an agent is user data. GenAI.mil is authorized unclassified/CUI only — classification boundaries must be explicit in the UI and in any service. |
| **Format authority** | The info/point paper format needs a real reference (like the SECNAV manual backing the letter work), not an invented layout. |
| **Auth** | CAC/PIV in a browser app is meaningfully harder than a server-to-server key. Another reason B beats A. |

---

## Next action

Phase 0, item 1: read the shared agent and `SKILL.md`, and confirm the direction
before writing any integration code. Phase 1 can start in parallel — it's useful
regardless of how the rest resolves.
