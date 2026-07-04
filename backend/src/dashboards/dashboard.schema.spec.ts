import { createTileSchema, layoutSchema, updateTileSchema } from './dashboard.schema';

const insightsDef = {
  events: [{ name: 'checkout_completed', aggregation: 'total' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  interval: 'day',
};
const REPORT_ID = '018f6b2e-0000-7000-8000-0000000000b1';

function tile(overrides: Record<string, unknown> = {}) {
  return { title: 'Checkouts', kind: 'insights', x: 0, y: 0, w: 6, h: 4, ...overrides };
}

describe('createTileSchema (contracts §16)', () => {
  it('accepts a tile backed by a saved report', () => {
    expect(createTileSchema.safeParse(tile({ saved_report_id: REPORT_ID })).success).toBe(true);
  });

  it('accepts a tile carrying an inline definition', () => {
    expect(createTileSchema.safeParse(tile({ inline_definition: insightsDef })).success).toBe(true);
  });

  describe('exactly-one-of rule', () => {
    it('rejects a tile with NEITHER saved_report_id nor inline_definition', () => {
      expect(createTileSchema.safeParse(tile()).success).toBe(false);
    });

    it('rejects a tile with BOTH saved_report_id and inline_definition', () => {
      expect(
        createTileSchema.safeParse(
          tile({ saved_report_id: REPORT_ID, inline_definition: insightsDef }),
        ).success,
      ).toBe(false);
    });
  });

  describe('12-column grid bounds', () => {
    it('rejects x + w > 12 (tile overflows the grid)', () => {
      expect(
        createTileSchema.safeParse(tile({ saved_report_id: REPORT_ID, x: 8, w: 6 })).success,
      ).toBe(false);
    });

    it('accepts x + w == 12 (tile fits exactly)', () => {
      expect(
        createTileSchema.safeParse(tile({ saved_report_id: REPORT_ID, x: 6, w: 6 })).success,
      ).toBe(true);
    });

    it.each([
      ['w', { w: 0 }],
      ['w', { w: 13 }],
      ['x', { x: -1 }],
      ['x', { x: 12 }],
      ['h', { h: 0 }],
    ])('rejects out-of-range %s', (_label, override) => {
      expect(
        createTileSchema.safeParse(tile({ saved_report_id: REPORT_ID, ...override })).success,
      ).toBe(false);
    });
  });
});

describe('updateTileSchema', () => {
  it('requires at least one field', () => {
    expect(updateTileSchema.safeParse({}).success).toBe(false);
    expect(updateTileSchema.safeParse({ title: 'Renamed' }).success).toBe(true);
    expect(updateTileSchema.safeParse({ w: 4 }).success).toBe(true);
  });

  it('rejects an out-of-range individual field', () => {
    expect(updateTileSchema.safeParse({ w: 99 }).success).toBe(false);
  });
});

describe('layoutSchema (contracts §16 batch grid save)', () => {
  const entry = { id: REPORT_ID, x: 0, y: 0, w: 6, h: 4, position: 0 };

  it('accepts a well-formed batch', () => {
    expect(layoutSchema.safeParse({ tiles: [entry] }).success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(layoutSchema.safeParse({ tiles: [] }).success).toBe(false);
  });

  it('rejects an entry that overflows the grid', () => {
    expect(layoutSchema.safeParse({ tiles: [{ ...entry, x: 10, w: 6 }] }).success).toBe(false);
  });
});
