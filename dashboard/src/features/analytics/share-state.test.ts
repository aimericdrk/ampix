import { describe, expect, it } from 'vitest';
import { decodeAnalysisState, encodeAnalysisState } from './share-state';

interface FixtureState {
  v: 1;
  from?: string;
  to?: string;
  segmentId?: string | null;
  events?: { name: string; aggregation: string }[];
  interval?: string;
  filters?: { property: string; op: string; value?: string }[];
  breakdownProperty?: string;
  chartType?: string;
}

const RICH_STATE: FixtureState = {
  v: 1,
  from: '2026-06-01',
  to: '2026-06-30',
  segmentId: 'cohort_recent_buyers',
  events: [
    { name: 'checkout_completed', aggregation: 'total' },
    { name: 'signup_completed', aggregation: 'unique_users' },
  ],
  interval: 'week',
  filters: [{ property: 'app_version', op: 'eq', value: '1.4.0' }],
  breakdownProperty: 'utm_source',
  chartType: 'bar',
};

describe('encodeAnalysisState / decodeAnalysisState', () => {
  it('round-trips a rich Insights-shaped state', () => {
    const encoded = encodeAnalysisState(RICH_STATE);
    expect(decodeAnalysisState<FixtureState>(encoded)).toEqual(RICH_STATE);
  });

  it('produces a URL-safe string: no "+", "/", or "=" padding characters', () => {
    // A state whose base64 (RFC 4648, standard alphabet) would contain '+', '/', and padding.
    const encoded = encodeAnalysisState({ v: 1, breakdownProperty: '???>>>///+++' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('round-trips an empty (defaults-only) state', () => {
    const encoded = encodeAnalysisState({ v: 1 });
    expect(decodeAnalysisState(encoded)).toEqual({ v: 1 });
  });

  it('returns null for undefined', () => {
    expect(decodeAnalysisState(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeAnalysisState('')).toBeNull();
  });

  it('returns null for a blank (whitespace-only) string', () => {
    expect(decodeAnalysisState('   ')).toBeNull();
  });

  it('returns null for garbage that is not valid base64url JSON', () => {
    expect(decodeAnalysisState('not-a-real-encoded-value!!!')).toBeNull();
  });

  it('returns null for well-formed base64 that decodes to non-JSON', () => {
    // btoa("not json") -> valid base64, but the payload doesn't parse as JSON.
    expect(decodeAnalysisState(btoa('not json'))).toBeNull();
  });

  it('returns null when the decoded value is not a plain object (e.g. an array or a number)', () => {
    expect(decodeAnalysisState(encodeAnalysisState([1, 2, 3] as never))).toBeNull();
    expect(decodeAnalysisState(encodeAnalysisState(42 as never))).toBeNull();
  });

  it('returns null on a version mismatch (e.g. { v: 2 })', () => {
    const encoded = encodeAnalysisState({ v: 2 } as never);
    expect(decodeAnalysisState(encoded)).toBeNull();
  });

  it('returns null when the version field is missing entirely', () => {
    const encoded = btoa(JSON.stringify({ from: '2026-06-01' }));
    expect(decodeAnalysisState(encoded)).toBeNull();
  });
});
