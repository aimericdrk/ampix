# Feature 17 — "Ask Your Data" (Natural-language → query, via Mistral)

Date: 2026-07-07 · Status: spec ready · Surface: backend (Mistral integration) + dashboard

## 1. What it is
Type a question in plain English — "conversion rate by OS over the last 30 days", "daily active users
this month", "top events for iOS" — and the app builds and runs the matching analysis. Powered by
**Mistral** translating the question into a validated Insights query definition; the user sees the
built query (and can edit it), so it's transparent, not a black box.

## 2. Why
- The single biggest lowering of the "I don't know how to build this query" barrier.
- Safe by construction: the LLM only chooses events/properties/aggregation/interval/filters from the
  project's real metadata; the output is strictly validated against the existing Insights schema and
  compiled through the same injection-safe engine — the model never emits SQL.

## 3. Design

### 3.1 Backend — Mistral integration + `POST /query/ask`
- **Config**: add optional `MISTRAL_API_KEY` (+ optional `MISTRAL_MODEL`, default e.g. `mistral-small-latest`)
  to app-config (zod, optional). No key → the feature is "unconfigured".
- **`MistralService`** (`ai/mistral.service.ts`), an injectable with a narrow interface
  `translateToInsights(question: string, context: { events: string[]; properties: string[] }): Promise<unknown>`:
  - Builds a chat request to `https://api.mistral.ai/v1/chat/completions` (fetch/undici) with:
    - a **system prompt** describing the exact target JSON shape (the `InsightsQueryDefinition`:
      `events:[{name,aggregation}]`, `date_range:{from,to}`, `interval`, `filters:[{property,op,value}]`,
      optional `breakdown:{property}`), the allowed enums (aggregation total|unique_users, interval
      hour|day|week|month, filter ops), and STRICT instructions to only use event names + property names
      from the provided lists, to resolve relative dates to concrete `YYYY-MM-DD`, and to output ONLY
      JSON (use Mistral's JSON response_format if available).
    - a **user message** = the question + the project's available `events`/`properties`.
  - Parses the model's JSON content → returns the raw object (unknown). Times out (~15s), maps transport
    errors to a clear failure. The interface makes it mockable in tests (no live call in unit tests).
- **Controller** `POST /api/v1/projects/:projectId/query/ask` (viewer+, `@HttpCode(200)`), body `{ question: string (1..500) }`:
  1. `assertMembership`; if `MISTRAL_API_KEY` unset → **503** ProblemDetails `{ title: 'AI query is not configured' }`.
  2. Gather the project's metadata (reuse `listEventNames` + `listProperties`) for context.
  3. `mistral.translateToInsights(question, context)` → raw object.
  4. **Validate** with `insightsQuerySchema` (`parseOrThrow`) → on failure, **422/400** ProblemDetails
     `{ title: 'Could not turn that into a query', detail: <zod message> }` (the LLM produced something
     invalid — never trust it).
  5. Optionally cross-check event/property names against the metadata (drop/clamp unknowns) for extra
     safety.
  6. Return `{ question, definition: <validated InsightsQueryDefinition> }`. (The frontend runs it via
     the normal insights endpoint so the user sees + can edit before/after running.)
- Register the service + controller in the analytics module. Docs §19.
- **Tests** (unit, mock `MistralService`): a valid model output → `{ definition }`; an invalid/garbage
  model output → 400/422; unconfigured (no key) → 503; the metadata is passed as context; the raw model
  output is never executed as SQL (it goes through the schema). Do NOT hit the live API.

### 3.2 Frontend — the Ask input
- `useAskData(projectId)` mutation → `POST /query/ask` → `{ question, definition }`.
- An **AskBar** (a prominent input with a sparkle icon + "Ask your data…") on the **Insights** page
  header (and/or a command-palette action "Ask your data"). On submit:
  - loading state ("Thinking…"), then hydrate the Insights builder from the returned `definition`
    (reuse feature-01's state hydration path) and **auto-run** it, with a visible note "Built from:
    <question> — edit below" so it's transparent + editable.
  - Errors surface as friendly messages: unconfigured → "AI query isn't set up (no Mistral key)";
    invalid → "I couldn't turn that into a query — try rephrasing".
- The AskBar is unobtrusive when unconfigured (hidden or shows a disabled hint) — detect via the 503 or
  a small `GET`/config flag; simplest: show it, and surface the 503 message on use.

## 4. States & edge cases
- No Mistral key → 503, friendly UI message; the rest of the app is unaffected.
- Model returns prose / non-JSON / invalid schema → 400/422, "try rephrasing" (never crash, never run).
- Model invents an event/property not in the project → schema still validates shape; the cross-check
  (step 5) or the empty result makes it obvious; optionally warn "used <event> which has no data".
- Very long/abusive question → capped at 500 chars; the prompt is fixed (no prompt-injection into
  system role since the question is a user-role message and the output is schema-validated regardless).
- Rate/latency → 15s timeout, spinner, cancelable.
- The definition is fully editable after building — the user is always in control.

## 5. Testing
- Backend unit tests as in §3.1 (mock the Mistral service).
- Frontend: an Insights/AskBar test with a mocked `/query/ask` returning a definition → submitting a
  question hydrates the builder + runs it (assert the posted insights query matches the definition);
  the 503 and 400 paths show the friendly messages.

## 6. Tasks
- T1 (backend): config `MISTRAL_API_KEY`; `MistralService` (interface + real fetch impl, gated) +
  `POST /query/ask` controller + validation + module wiring + docs §19 + unit tests (mock service).
- T2 (frontend): `useAskData` + `AskBar` on Insights (hydrate + auto-run + friendly errors) + palette
  action + tests.

## 7. Later
- Stream the model's reasoning; support funnels/retention/flows/histogram question types (route by
  intent); "explain this chart" (reverse: data → prose); server-side caching of Q→definition.
