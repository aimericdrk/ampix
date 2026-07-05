import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { authStore } from '../features/auth/store';
import { currentOrgStore } from '../features/orgs/store';
import { resetAuthState, resetOrgsState } from './msw/handlers';
import { resetPhase5State } from './msw/phase5-handlers';
import { server } from './msw/server';

// Radix UI relies on browser APIs jsdom does not implement.
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.setPointerCapture ??= () => {};
window.HTMLElement.prototype.releasePointerCapture ??= () => {};
window.HTMLElement.prototype.scrollIntoView ??= () => {};

// TanStack Router's scroll restoration calls window.scrollTo, which jsdom leaves unimplemented.
window.scrollTo = () => {};

// jsdom does not implement object URLs; the authed-screenshot flow (§18) turns image blobs into
// object URLs, so stub them for the <img>/heatmap-overlay components.
window.URL.createObjectURL = () => 'blob:mock-screenshot';
window.URL.revokeObjectURL = () => {};
globalThis.ResizeObserver ??= class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// recharts' <ResponsiveContainer> measures its parent via getBoundingClientRect/offset*; jsdom
// reports 0 for every element, which makes it render nothing. Give every element a stable,
// plausible size so chart tests exercise the real rendered SVG instead of an empty container.
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  value: 800,
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 400,
});
window.HTMLElement.prototype.getBoundingClientRect = () =>
  ({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    right: 800,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON() {},
  }) as DOMRect;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  resetAuthState();
  resetOrgsState();
  resetPhase5State();
  authStore.reset();
  currentOrgStore.reset();
  localStorage.clear();
});

afterAll(() => server.close());
