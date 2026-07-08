import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnnotations } from './annotations';

const PROJECT_ID = 'proj-1';

describe('useAnnotations', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));
    expect(result.current.annotations).toEqual([]);
  });

  it('adds an annotation and persists it to localStorage', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => result.current.add({ date: '2026-06-30', label: 'v1.4 release' }));

    expect(result.current.annotations).toEqual([
      { id: '2026-06-30-v1-4-release', date: '2026-06-30', label: 'v1.4 release' },
    ]);
    const stored = JSON.parse(localStorage.getItem(`myampix:annotations:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual(result.current.annotations);
  });

  it('sorts annotations by date, then label', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => {
      result.current.add({ date: '2026-07-01', label: 'Campaign launch' });
      result.current.add({ date: '2026-06-29', label: 'Pricing change' });
      result.current.add({ date: '2026-06-29', label: 'App update' });
    });

    expect(result.current.annotations.map((a) => a.label)).toEqual([
      'App update',
      'Pricing change',
      'Campaign launch',
    ]);
  });

  it('dedupes ids for the same date+label pair, while still allowing the duplicate note', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => {
      result.current.add({ date: '2026-06-30', label: 'v1.4 release' });
      result.current.add({ date: '2026-06-30', label: 'v1.4 release' });
    });

    expect(result.current.annotations).toHaveLength(2);
    const ids = result.current.annotations.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('2026-06-30-v1-4-release');
    expect(ids).toContain('2026-06-30-v1-4-release-2');
  });

  it('rejects an empty (or whitespace-only) label', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => {
      result.current.add({ date: '2026-06-30', label: '' });
      result.current.add({ date: '2026-06-30', label: '   ' });
    });

    expect(result.current.annotations).toEqual([]);
  });

  it('removes an annotation by id', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => result.current.add({ date: '2026-06-30', label: 'v1.4 release' }));
    const [added] = result.current.annotations;

    act(() => result.current.remove(added!.id));

    expect(result.current.annotations).toEqual([]);
    const stored = JSON.parse(localStorage.getItem(`myampix:annotations:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual([]);
  });

  it('updates an annotation in place, keeping its id', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    act(() => result.current.add({ date: '2026-06-30', label: 'v1.4 release' }));
    const [added] = result.current.annotations;

    act(() => result.current.update(added!.id, { label: 'v1.4.1 hotfix' }));

    expect(result.current.annotations).toEqual([
      { id: added!.id, date: '2026-06-30', label: 'v1.4.1 hotfix' },
    ]);
  });

  it('persists per project, isolated from other projects', () => {
    const { result } = renderHook(() => useAnnotations(PROJECT_ID));
    act(() => result.current.add({ date: '2026-06-30', label: 'v1.4 release' }));

    expect(localStorage.getItem('myampix:annotations:other-project')).toBeNull();
    expect(localStorage.getItem(`myampix:annotations:${PROJECT_ID}`)).not.toBeNull();

    const { result: otherResult } = renderHook(() => useAnnotations('other-project'));
    expect(otherResult.current.annotations).toEqual([]);
  });

  it('reads a previously persisted set for the project on mount', () => {
    localStorage.setItem(
      `myampix:annotations:${PROJECT_ID}`,
      JSON.stringify([{ id: 'x', date: '2026-06-29', label: 'Existing note' }]),
    );

    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    expect(result.current.annotations).toEqual([
      { id: 'x', date: '2026-06-29', label: 'Existing note' },
    ]);
  });

  it('falls back to an empty list when storage holds corrupt JSON', () => {
    localStorage.setItem(`myampix:annotations:${PROJECT_ID}`, 'not-json{{{');

    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    expect(result.current.annotations).toEqual([]);
  });

  it('falls back to an empty list when storage holds a non-array payload', () => {
    localStorage.setItem(`myampix:annotations:${PROJECT_ID}`, JSON.stringify({ not: 'an array' }));

    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    expect(result.current.annotations).toEqual([]);
  });

  it('drops malformed entries within an otherwise-valid array', () => {
    localStorage.setItem(
      `myampix:annotations:${PROJECT_ID}`,
      JSON.stringify([
        { id: 'ok', date: '2026-06-29', label: 'Good note' },
        { id: 'bad', label: 'Missing date' },
        'not-an-object',
        null,
      ]),
    );

    const { result } = renderHook(() => useAnnotations(PROJECT_ID));

    expect(result.current.annotations).toEqual([{ id: 'ok', date: '2026-06-29', label: 'Good note' }]);
  });
});
