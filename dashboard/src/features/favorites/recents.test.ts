import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RECENTS_CAP, useRecents } from './recents';

const PROJECT_ID = 'proj-1';

describe('useRecents', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));
    expect(result.current.list).toEqual([]);
  });

  it('records an item, most-recent first', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));

    act(() => result.current.record({ type: 'report', id: 'r1', name: 'Weekly checkouts' }));
    act(() => result.current.record({ type: 'dashboard', id: 'd1', name: 'Growth overview' }));

    expect(result.current.list).toEqual([
      { type: 'dashboard', id: 'd1', name: 'Growth overview' },
      { type: 'report', id: 'r1', name: 'Weekly checkouts' },
    ]);
  });

  it('dedupes by type+id, moving the re-recorded item back to the top instead of duplicating it', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));

    act(() => {
      result.current.record({ type: 'report', id: 'r1', name: 'Weekly checkouts' });
      result.current.record({ type: 'dashboard', id: 'd1', name: 'Growth overview' });
      result.current.record({ type: 'report', id: 'r1', name: 'Weekly checkouts' });
    });

    expect(result.current.list).toEqual([
      { type: 'report', id: 'r1', name: 'Weekly checkouts' },
      { type: 'dashboard', id: 'd1', name: 'Growth overview' },
    ]);
  });

  it('updates the name on re-record (e.g. a renamed report)', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));

    act(() => result.current.record({ type: 'report', id: 'r1', name: 'Old name' }));
    act(() => result.current.record({ type: 'report', id: 'r1', name: 'New name' }));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'New name' }]);
  });

  it(`caps the list at ${RECENTS_CAP} entries, dropping the oldest`, () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));

    act(() => {
      for (let i = 0; i < RECENTS_CAP + 5; i++) {
        result.current.record({ type: 'report', id: `r${i}`, name: `Report ${i}` });
      }
    });

    expect(result.current.list).toHaveLength(RECENTS_CAP);
    expect(result.current.list[0]).toEqual({
      type: 'report',
      id: `r${RECENTS_CAP + 4}`,
      name: `Report ${RECENTS_CAP + 4}`,
    });
    // The oldest entries (r0..r4) were pushed out.
    expect(result.current.list.some((item) => item.id === 'r0')).toBe(false);
  });

  it('persists to localStorage on record', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));

    act(() => result.current.record({ type: 'user', id: 'u1', name: 'user-001' }));

    const stored = JSON.parse(localStorage.getItem(`myampix:recents:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual([{ type: 'user', id: 'u1', name: 'user-001' }]);
  });

  it('keeps recents isolated per project', () => {
    const { result } = renderHook(() => useRecents(PROJECT_ID));
    act(() => result.current.record({ type: 'cohort', id: 'c1', name: 'Recent buyers' }));

    const { result: otherResult } = renderHook(() => useRecents('other-project'));
    expect(otherResult.current.list).toEqual([]);
  });

  it('reads a previously persisted list for the project on mount', () => {
    localStorage.setItem(
      `myampix:recents:${PROJECT_ID}`,
      JSON.stringify([{ type: 'report', id: 'r1', name: 'Weekly checkouts' }]),
    );

    const { result } = renderHook(() => useRecents(PROJECT_ID));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'Weekly checkouts' }]);
  });

  it('falls back to an empty list when storage holds corrupt JSON', () => {
    localStorage.setItem(`myampix:recents:${PROJECT_ID}`, 'not-json{{{');

    const { result } = renderHook(() => useRecents(PROJECT_ID));

    expect(result.current.list).toEqual([]);
  });

  it('falls back to an empty list when storage holds a non-array payload', () => {
    localStorage.setItem(`myampix:recents:${PROJECT_ID}`, JSON.stringify({ not: 'an array' }));

    const { result } = renderHook(() => useRecents(PROJECT_ID));

    expect(result.current.list).toEqual([]);
  });

  it('drops malformed entries within an otherwise-valid array', () => {
    localStorage.setItem(
      `myampix:recents:${PROJECT_ID}`,
      JSON.stringify([
        { type: 'report', id: 'r1', name: 'Good report' },
        { type: 'report', id: 'r2' },
        'not-an-object',
        null,
      ]),
    );

    const { result } = renderHook(() => useRecents(PROJECT_ID));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'Good report' }]);
  });
});
