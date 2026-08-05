import { z } from 'zod';

/**
 * RevenueCat webhook v1 payload (https://www.revenuecat.com/docs/integrations/webhooks).
 * Lenient by design: only the fields we act on are required; everything else passes
 * through so future RC fields never break ingestion (journal keeps the full payload).
 */
export const rcWebhookEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    original_app_user_id: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    product_id: z.string().nullish(),
    period_type: z.string().nullish(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullish(),
    event_timestamp_ms: z.number(),
    store: z.string().nullish(),
    environment: z.string().nullish(),
    price: z.number().nullish(),
    currency: z.string().nullish(),
    transaction_id: z.string().nullish(),
    cancel_reason: z.string().nullish(),
    expiration_reason: z.string().nullish(),
    new_product_id: z.string().nullish(),
  })
  .passthrough();

export const rcWebhookBodySchema = z
  .object({ api_version: z.string().optional(), event: rcWebhookEventSchema })
  .passthrough();

export type RcWebhookEvent = z.infer<typeof rcWebhookEventSchema>;
