import type { AppConfig } from '../../config/app-config';
import { AiRequestError, AiUnconfiguredError, MistralService } from './mistral.service';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    databaseUrl: 'postgresql://x',
    clickhouse: { url: 'http://x', user: 'u', password: 'p', database: 'd' },
    redisUrl: 'redis://x',
    jwtAccessSecret: undefined,
    jwtRefreshSecret: undefined,
    ingestMaxBatch: 100,
    ingestMaxBodyKb: 1024,
    ingestRateLimitPerMin: 1000,
    screenshotMaxKb: 512,
    mistralApiKey: 'test-key',
    mistralModel: 'mistral-small-latest',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('MistralService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  describe('translateToInsights', () => {
    it('throws AiUnconfiguredError and never calls fetch when MISTRAL_API_KEY is unset', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig({ mistralApiKey: undefined }));

      await expect(
        service.translateToInsights('daily active users', { events: [], properties: [] }),
      ).rejects.toBeInstanceOf(AiUnconfiguredError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs to the Mistral chat completions endpoint with the key, model, JSON response_format, and system+user messages', async () => {
      const modelOutput = {
        events: [{ name: 'checkout_completed', aggregation: 'total' }],
        date_range: { from: '2026-06-01', to: '2026-07-01' },
        interval: 'day',
        filters: [],
      };
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      const result = await service.translateToInsights('conversions this month', {
        events: ['checkout_completed', 'app_open'],
        properties: ['os', 'utm_source'],
      });

      expect(result).toEqual(modelOutput);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('mistral-small-latest');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      // The user message carries the question and the project's metadata lists so the model can
      // only pick real event/property names.
      expect(body.messages[1].content).toContain('conversions this month');
      expect(body.messages[1].content).toContain('checkout_completed');
      expect(body.messages[1].content).toContain('utm_source');
      // The system message documents the strict output contract.
      expect(body.messages[0].content).toMatch(/only use event\/property names|only use.*names/i);
      expect(body.messages[0].content).toContain('JSON');
    });

    it('falls back to mistral-small-latest when mistralModel is somehow unset', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: '{}' } }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig({ mistralModel: undefined }));

      await service.translateToInsights('q', { events: [], properties: [] });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe('mistral-small-latest');
    });

    it('parses the assistant message content as JSON and returns the object', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: '{"interval":"day","events":[]}' } }],
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      const result = await service.translateToInsights('q', { events: [], properties: [] });

      expect(result).toEqual({ interval: 'day', events: [] });
    });

    it('throws AiRequestError when the network call rejects', async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      await expect(
        service.translateToInsights('q', { events: [], properties: [] }),
      ).rejects.toBeInstanceOf(AiRequestError);
    });

    it('throws AiRequestError on a non-2xx response', async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, false, 500));
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      await expect(
        service.translateToInsights('q', { events: [], properties: [] }),
      ).rejects.toBeInstanceOf(AiRequestError);
    });

    it('throws AiRequestError when the response has no message content', async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ choices: [] }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      await expect(
        service.translateToInsights('q', { events: [], properties: [] }),
      ).rejects.toBeInstanceOf(AiRequestError);
    });

    it('throws AiRequestError when the message content is not valid JSON (e.g. prose)', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: 'Sure! Here is your answer: ...' } }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      await expect(
        service.translateToInsights('q', { events: [], properties: [] }),
      ).rejects.toBeInstanceOf(AiRequestError);
    });

    it('aborts and throws AiRequestError after the 15s timeout', async () => {
      jest.useFakeTimers();
      const fetchMock = jest.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
            });
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new MistralService(makeConfig());

      const promise = service.translateToInsights('q', { events: [], properties: [] });
      // Attach a rejection handler immediately so advancing timers doesn't trigger an unhandled
      // rejection warning before the `expect(...).rejects` assertion attaches its own.
      const assertion = expect(promise).rejects.toBeInstanceOf(AiRequestError);
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    });
  });
});
