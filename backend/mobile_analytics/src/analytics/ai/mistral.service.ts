import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

const MISTRAL_CHAT_COMPLETIONS_URL = 'https://api.mistral.ai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'mistral-small-latest';

/** feat-17 §3.1 — the project metadata the model is allowed to reference. */
export interface AskContext {
  events: string[];
  properties: string[];
}

/** Thrown when `MISTRAL_API_KEY` isn't set — "Ask your data" is simply unconfigured. The
 *  controller maps this to a 503, never a 500 (it isn't a bug, it's a missing optional feature). */
export class AiUnconfiguredError extends Error {
  constructor() {
    super('MISTRAL_API_KEY is not configured');
    this.name = 'AiUnconfiguredError';
  }
}

/** Every other failure talking to Mistral — network error, timeout, non-2xx response, or a
 *  response whose message content isn't parseable JSON — collapses to this one typed error so
 *  callers never need to know Mistral's wire format. */
export class AiRequestError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AiRequestError';
    this.cause = cause;
  }
}

/**
 * Fixed system prompt (contracts feat-17 §3.1): describes the exact target JSON shape (the
 * `InsightsQueryDefinition` validated downstream by `insightsQuerySchema`) and the allowed enums,
 * plus STRICT output rules. Deliberately generic/static — the dynamic parts (the question and the
 * project's real event/property names) live in the user message, never here, so this string can be
 * a plain constant.
 */
const SYSTEM_PROMPT = `You translate a natural-language analytics question into a single JSON object matching this exact shape (an "InsightsQueryDefinition"):

{
  "events": [ { "name": "<event name>", "aggregation": "total" | "unique_users" } ],  // 1..5 events
  "date_range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },                          // inclusive UTC dates
  "interval": "hour" | "day" | "week" | "month",
  "filters": [ { "property": "<property name>", "op": "eq" | "neq" | "contains" | "gt" | "lt" | "is_set" | "is_not_set", "value"?: string | number | boolean } ],
  "breakdown": { "property": "<property name>" }   // optional
}

STRICT rules:
- Only use event names and property names from the "Available events" / "Available properties" lists given in the user message. Never invent a name that isn't in those lists.
- Resolve any relative date phrase ("last 30 days", "this month", "yesterday") to concrete "YYYY-MM-DD" dates.
- Output ONLY the JSON object described above — no prose, no markdown code fences, no explanation.`;

function buildUserMessage(question: string, context: AskContext): string {
  return [
    `Question: ${question}`,
    `Available events: ${JSON.stringify(context.events)}`,
    `Available properties: ${JSON.stringify(context.properties)}`,
  ].join('\n');
}

/**
 * The journey-analysis system prompt. Where {@link SYSTEM_PROMPT} asks the model to TRANSLATE, this
 * one asks it to READ: the user message carries an already-computed report whose every block states
 * its own units, cohort sizes and cohort definitions, so the model needs no schema knowledge and no
 * tool access to reason about it.
 *
 * The rules exist because the failure mode here is confident narration of noise: a 4-user cohort
 * will happily produce a "3.2x lift" the model is glad to explain. Grounding each finding in cited
 * figures, and requiring the thin-data caveat, is what keeps the output auditable against the
 * `report` the caller also receives.
 */
const JOURNEY_SYSTEM_PROMPT = `You analyse a behavioural analytics report about what users did before an outcome (subscribing, or being refunded). The report compares a COHORT (users who had the outcome) against a CONTROL group (comparable users who did not). Every block in the report states its own units and definitions — read them.

Reply with ONLY a JSON object of this exact shape:

{
  "headline": "<one sentence: the single most important thing in this report>",
  "findings": [ { "title": "<short claim>", "detail": "<2-3 sentences explaining it and what to do about it>", "evidence": ["<the specific figures this rests on>"] } ],
  "caveats": ["<where the data does not support a conclusion>"]
}

STRICT rules:
- Ground EVERY finding in figures that appear in the report, and put those figures in "evidence". Never state a number that is not in the report, and never compute a ratio the report reports as null.
- A difference between cohort and control is the only thing that is a finding. A number that is similar in both groups is not interesting no matter how large it is — say so instead of dressing it up.
- If the cohort or control has fewer than 30 users, say plainly in "caveats" that the sample is too small to conclude from, and soften every finding accordingly.
- If "path" steps have a low "share", the cohort does NOT follow one common path; report that as the finding rather than presenting the modal path as typical.
- 3 to 5 findings, ordered most important first. Prefer fewer, better-supported findings over a long list.
- No prose outside the JSON object, no markdown code fences.`;

interface MistralChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/**
 * feat-17 §3.1 — thin, fully-mockable wrapper around the Mistral chat-completions API. Returns the
 * model's JSON content as an untyped `unknown`; it is NEVER trusted or executed here — the caller
 * (AnalyticsController) validates it against `insightsQuerySchema` before it can reach ClickHouse.
 */
@Injectable()
export class MistralService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async translateToInsights(question: string, context: AskContext): Promise<unknown> {
    return this.complete(SYSTEM_PROMPT, buildUserMessage(question, context));
  }

  /**
   * One JSON-mode chat completion. Shared by every prompt in this service so the key check, the
   * timeout, the non-2xx handling and the "content must parse as JSON" contract are written once —
   * a second prompt must not mean a second copy of the error taxonomy.
   */
  private async complete(systemPrompt: string, userMessage: string): Promise<unknown> {
    const apiKey = this.config.mistralApiKey;
    if (!apiKey) {
      throw new AiUnconfiguredError();
    }
    const model = this.config.mistralModel ?? DEFAULT_MODEL;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AiRequestError('Failed to reach the Mistral API', err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AiRequestError(`Mistral API responded with status ${response.status}`);
    }

    let payload: MistralChatCompletionResponse;
    try {
      payload = (await response.json()) as MistralChatCompletionResponse;
    } catch (err) {
      throw new AiRequestError('Mistral API returned a non-JSON response', err);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AiRequestError('Mistral API response is missing message content');
    }

    try {
      return JSON.parse(content);
    } catch (err) {
      throw new AiRequestError('Mistral API returned content that is not valid JSON', err);
    }
  }

  /**
   * Reads an already-computed subscription-journey report and returns the model's findings as
   * untyped JSON. Like {@link translateToInsights}, the result is NEVER trusted here — the caller
   * validates it before it reaches a response body. The report is serialised straight into the user
   * message: it is our own aggregate, carries no per-user rows, and is self-describing by
   * construction, so there is nothing to summarise or redact on the way in.
   */
  async analyzeJourney(report: unknown): Promise<unknown> {
    return this.complete(JOURNEY_SYSTEM_PROMPT, JSON.stringify(report));
  }
}
