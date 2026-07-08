import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFavorites } from './favorites';

const PROJECT_ID = 'proj-1';

describe('useFavorites', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));
    expect(result.current.list).toEqual([]);
  });

  it('toggle adds an item and isFavorite reflects it', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    act(() => result.current.toggle({ type: 'report', id: 'r1', name: 'Weekly checkouts' }));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'Weekly checkouts' }]);
    expect(result.current.isFavorite('report', 'r1')).toBe(true);
    expect(result.current.isFavorite('dashboard', 'r1')).toBe(false);
    expect(result.current.isFavorite('report', 'other')).toBe(false);
  });

  it('toggle removes an already-favorited item', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    act(() => result.current.toggle({ type: 'dashboard', id: 'd1', name: 'Growth overview' }));
    expect(result.current.isFavorite('dashboard', 'd1')).toBe(true);

    act(() => result.current.toggle({ type: 'dashboard', id: 'd1', name: 'Growth overview' }));

    expect(result.current.isFavorite('dashboard', 'd1')).toBe(false);
    expect(result.current.list).toEqual([]);
  });

  it('persists to localStorage on toggle', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    act(() => result.current.toggle({ type: 'user', id: 'u1', name: 'user-001' }));

    const stored = JSON.parse(localStorage.getItem(`myampix:favorites:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual([{ type: 'user', id: 'u1', name: 'user-001' }]);
  });

  it('keeps favorites isolated per project', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));
    act(() => result.current.toggle({ type: 'cohort', id: 'c1', name: 'Recent buyers' }));

    const { result: otherResult } = renderHook(() => useFavorites('other-project'));
    expect(otherResult.current.list).toEqual([]);
    expect(otherResult.current.isFavorite('cohort', 'c1')).toBe(false);
  });

  it('reads a previously persisted list for the project on mount', () => {
    localStorage.setItem(
      `myampix:favorites:${PROJECT_ID}`,
      JSON.stringify([{ type: 'report', id: 'r1', name: 'Weekly checkouts' }]),
    );

    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'Weekly checkouts' }]);
  });

  it('falls back to an empty list when storage holds corrupt JSON', () => {
    localStorage.setItem(`myampix:favorites:${PROJECT_ID}`, 'not-json{{{');

    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    expect(result.current.list).toEqual([]);
  });

  it('falls back to an empty list when storage holds a non-array payload', () => {
    localStorage.setItem(`myampix:favorites:${PROJECT_ID}`, JSON.stringify({ not: 'an array' }));

    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    expect(result.current.list).toEqual([]);
  });

  it('drops malformed entries within an otherwise-valid array', () => {
    localStorage.setItem(
      `myampix:favorites:${PROJECT_ID}`,
      JSON.stringify([
        { type: 'report', id: 'r1', name: 'Good report' },
        { type: 'report', id: 'r2' },
        { type: 'not-a-type', id: 'r3', name: 'Bad type' },
        'not-an-object',
        null,
      ]),
    );

    const { result } = renderHook(() => useFavorites(PROJECT_ID));

    expect(result.current.list).toEqual([{ type: 'report', id: 'r1', name: 'Good report' }]);
  });

  it('does not error when storage is absent for the key', () => {
    const { result } = renderHook(() => useFavorites(PROJECT_ID));
    expect(result.current.list).toEqual([]);
    expect(result.current.isFavorite('report', 'anything')).toBe(false);
  });
});
