import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEventDescriptions } from './event-descriptions';

const PROJECT_ID = 'proj-1';

describe('useEventDescriptions', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));
    expect(result.current.all).toEqual({});
    expect(result.current.get('checkout_completed')).toBe('');
  });

  it('set stores a description and get reflects it', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    act(() => result.current.set('checkout_completed', 'Fired when a checkout finishes.'));

    expect(result.current.get('checkout_completed')).toBe('Fired when a checkout finishes.');
    expect(result.current.get('product_viewed')).toBe('');
  });

  it('persists to localStorage on set', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    act(() => result.current.set('signup_completed', 'A new user finished signup.'));

    const stored = JSON.parse(localStorage.getItem(`myampix:eventdescs:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual({ signup_completed: 'A new user finished signup.' });
  });

  it('overwrites an existing description for the same event', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    act(() => result.current.set('app_opened', 'First draft.'));
    act(() => result.current.set('app_opened', 'Revised description.'));

    expect(result.current.get('app_opened')).toBe('Revised description.');
    expect(result.current.all).toEqual({ app_opened: 'Revised description.' });
  });

  it('reads a previously persisted map for the project on mount', () => {
    localStorage.setItem(
      `myampix:eventdescs:${PROJECT_ID}`,
      JSON.stringify({ checkout_completed: 'Existing note.' }),
    );

    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    expect(result.current.get('checkout_completed')).toBe('Existing note.');
  });

  it('falls back to an empty map when storage holds corrupt JSON', () => {
    localStorage.setItem(`myampix:eventdescs:${PROJECT_ID}`, 'not-json{{{');

    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    expect(result.current.all).toEqual({});
  });

  it('falls back to an empty map when storage holds a non-object payload', () => {
    localStorage.setItem(`myampix:eventdescs:${PROJECT_ID}`, JSON.stringify(['not', 'a', 'map']));

    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    expect(result.current.all).toEqual({});
  });

  it('drops non-string values within an otherwise-valid map', () => {
    localStorage.setItem(
      `myampix:eventdescs:${PROJECT_ID}`,
      JSON.stringify({ good_event: 'A fine note.', bad_event: 42, another_bad: null }),
    );

    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));

    expect(result.current.all).toEqual({ good_event: 'A fine note.' });
  });

  it('keeps descriptions isolated per project', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));
    act(() => result.current.set('checkout_completed', 'Project 1 note.'));

    const { result: otherResult } = renderHook(() => useEventDescriptions('other-project'));
    expect(otherResult.current.all).toEqual({});
    expect(otherResult.current.get('checkout_completed')).toBe('');
  });

  it('does not error when storage is absent for the key', () => {
    const { result } = renderHook(() => useEventDescriptions(PROJECT_ID));
    expect(result.current.all).toEqual({});
    expect(result.current.get('anything')).toBe('');
  });
});
