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
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(question, context) },
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
}
