import { Injectable } from '@nestjs/common';

const RC_API_BASE = 'https://api.revenuecat.com';
const TIMEOUT_MS = 15_000;

export interface RcCustomer { id: string }
export interface RcApiSubscription {
  product_id: string;
  store: string;
  status: string;
  current_period_ends_at: number | null;
  gives_access: boolean;
  total_revenue_in_usd?: { gross: number };
}

/** Thin RevenueCat REST API v2 wrapper; fetch injected for tests (Mistral pattern). */
@Injectable()
export class RcApiClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async get<T>(apiKey: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${RC_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`revenuecat api ${res.status} for ${path}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async *listCustomers(apiKey: string, rcProjectId: string): AsyncGenerator<RcCustomer[]> {
    let path: string | null = `/v2/projects/${encodeURIComponent(rcProjectId)}/customers?limit=100`;
    while (path !== null) {
      const page: { items: RcCustomer[]; next_page?: string | null } = await this.get(apiKey, path);
      yield page.items ?? [];
      path = page.next_page ?? null;
    }
  }

  async getSubscriptions(apiKey: string, rcProjectId: string, customerId: string): Promise<RcApiSubscription[]> {
    const res = await this.get<{ items: RcApiSubscription[] }>(
      apiKey,
      `/v2/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(customerId)}/subscriptions`,
    );
    return res.items ?? [];
  }
}
