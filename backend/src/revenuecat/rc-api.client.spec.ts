import { RcApiClient } from './rc-api.client';

function fetchMock(pages: Array<{ items: unknown[]; next_page?: string | null }>) {
  let call = 0;
  return jest.fn(async (url: string, init: any) => {
    expect(init.headers.Authorization).toBe('Bearer sk_test');
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return { ok: true, status: 200, json: async () => page } as Response;
  }) as unknown as typeof fetch;
}

describe('RcApiClient', () => {
  it('pages customers via next_page until exhausted', async () => {
    const f = fetchMock([
      { items: [{ id: 'c1' }, { id: 'c2' }], next_page: '/v2/projects/p1/customers?starting_after=c2' },
      { items: [{ id: 'c3' }], next_page: null },
    ]);
    const client = new RcApiClient(f);
    const batches: unknown[][] = [];
    for await (const batch of client.listCustomers('sk_test', 'p1')) batches.push(batch);
    expect(batches).toEqual([[{ id: 'c1' }, { id: 'c2' }], [{ id: 'c3' }]]);
    expect((f as unknown as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.revenuecat.com/v2/projects/p1/customers?limit=100',
    );
    expect((f as unknown as jest.Mock).mock.calls[1][0]).toBe(
      'https://api.revenuecat.com/v2/projects/p1/customers?starting_after=c2',
    );
  });

  it('throws a descriptive error on non-2xx', async () => {
    const f = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const client = new RcApiClient(f);
    await expect(client.getSubscriptions('bad', 'p1', 'c1')).rejects.toThrow(/revenuecat api 401/i);
  });
});
