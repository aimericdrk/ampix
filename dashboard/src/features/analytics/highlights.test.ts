import { describe, expect, it } from 'vitest';
import { computeHighlights } from './highlights';

describe('computeHighlights', () => {
  it('ranks the biggest real move first', () => {
    const highlights = computeHighlights([
      { label: 'Sessions', current: 124, previous: 100 }, // +24%
      { label: 'DAU', current: 108, previous: 100 }, // +8%
    ]);

    expect(highlights.map((h) => h.id)).toEqual(['metric-sessions', 'metric-dau']);
    expect(highlights[0]).toMatchObject({
      text: 'Sessions up 24% vs previous period',
      tone: 'positive',
    });
    expect(highlights[1]).toMatchObject({ text: 'DAU up 8% vs previous period', tone: 'positive' });
  });

  it('marks a decrease as negative when higher is better (the default)', () => {
    const [highlight] = computeHighlights([{ label: 'Sessions', current: 76, previous: 100 }]);

    expect(highlight).toMatchObject({
      text: 'Sessions down 24% vs previous period',
      tone: 'negative',
    });
  });

  it('respects higherIsBetter: false, so a decrease reads as positive', () => {
    const [highlight] = computeHighlights([
      { label: 'Avg. load time', current: 76, previous: 100, higherIsBetter: false },
    ]);

    expect(highlight).toMatchObject({
      text: 'Avg. load time down 24% vs previous period',
      tone: 'positive',
    });
  });

  it('marks an increase as negative when higherIsBetter is false', () => {
    const [highlight] = computeHighlights([
      { label: 'Avg. load time', current: 124, previous: 100, higherIsBetter: false },
    ]);

    expect(highlight).toMatchObject({
      text: 'Avg. load time up 24% vs previous period',
      tone: 'negative',
    });
  });

  it('treats a small change below the threshold as neutral/flat', () => {
    const [highlight] = computeHighlights([{ label: 'Stickiness', current: 101, previous: 100 }]);

    expect(highlight).toMatchObject({
      text: 'Stickiness roughly flat vs previous period',
      tone: 'neutral',
    });
  });

  it('skips a metric that is zero in both periods (nothing to say)', () => {
    expect(computeHighlights([{ label: 'Revenue', current: 0, previous: 0 }])).toEqual([]);
  });

  it('reports brand-new data when previous is zero and current is positive', () => {
    const [highlight] = computeHighlights([{ label: 'Revenue', current: 42, previous: 0 }]);

    expect(highlight).toMatchObject({
      text: 'Revenue: first data this period',
      tone: 'neutral',
    });
  });

  it('adds a neutral top-event highlight from extras', () => {
    const highlights = computeHighlights([], { topEvent: { event: 'checkout_completed', count: 32 } });

    expect(highlights).toEqual([
      {
        id: 'top-event',
        text: 'Top event: checkout_completed (32)',
        tone: 'neutral',
        magnitude: 0,
      },
    ]);
  });

  it('always sorts the top-event highlight last, even behind small/neutral moves', () => {
    const highlights = computeHighlights(
      [
        { label: 'Sessions', current: 124, previous: 100 }, // +24%, positive
        { label: 'Stickiness', current: 101, previous: 100 }, // flat, neutral
      ],
      { topEvent: { event: 'checkout_completed', count: 32 } },
    );

    expect(highlights.map((h) => h.id)).toEqual(['metric-sessions', 'metric-stickiness', 'top-event']);
  });

  it('caps the result at 4, dropping the least significant entries', () => {
    const highlights = computeHighlights([
      { label: 'Sessions', current: 200, previous: 100 }, // +100%
      { label: 'DAU', current: 150, previous: 100 }, // +50%
      { label: 'WAU', current: 130, previous: 100 }, // +30%
      { label: 'MAU', current: 120, previous: 100 }, // +20%
      { label: 'Top-5 events', current: 110, previous: 100 }, // +10%, should be dropped
    ]);

    expect(highlights).toHaveLength(4);
    expect(highlights.map((h) => h.id)).toEqual([
      'metric-sessions',
      'metric-dau',
      'metric-wau',
      'metric-mau',
    ]);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const metrics = [
      { label: 'Sessions', current: 124, previous: 100 },
      { label: 'DAU', current: 90, previous: 100 },
    ];

    expect(computeHighlights(metrics)).toEqual(computeHighlights(metrics));
  });
});
