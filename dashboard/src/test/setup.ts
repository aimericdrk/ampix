import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { authStore } from '../features/auth/store';
import { resetAuthState } from './msw/handlers';
import { server } from './msw/server';

// Radix UI relies on browser APIs jsdom does not implement.
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.setPointerCapture ??= () => {};
window.HTMLElement.prototype.releasePointerCapture ??= () => {};
window.HTMLElement.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  resetAuthState();
  authStore.reset();
  localStorage.clear();
});

afterAll(() => server.close());
