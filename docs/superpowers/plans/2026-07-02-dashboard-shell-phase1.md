# Dashboard Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-buildable React SPA shell in `dashboard/`: runtime-configurable static build, themed UI kit, typed API client with RFC 7807 errors and silent token refresh, routed app with auth guards, working login/signup against MSW-mocked contracts-§7 endpoints, app layout, and full test rigs (Vitest + Testing Library + MSW, Playwright smoke). **Analytics pages (live feed, insights, funnels, retention, flows, users, cohorts, dashboards, attribution) are later milestones** — this phase ships only placeholders behind the private layout. Design: `../specs/2026-07-02-dashboard-design.md`; contracts: `../specs/2026-07-02-shared-contracts.md` (§7 auth/API, §2 ports).

**Architecture:** Feature-folder SPA (`src/features/<x>` + shared `src/lib` and `src/components/ui`) built with Vite 6 to a static `dist/` whose API base URL is injected at runtime by a `config.js` loaded before the bundle. All server traffic flows through one typed `apiFetch` that injects the in-memory access JWT, normalizes RFC 7807 problems, and transparently refreshes+replays on 401 using the httpOnly refresh cookie. TanStack Router guards public/private trees; MSW implements the contracts §7 endpoints for every test layer.

**Tech Stack:** Vite 6 · React 18 · TypeScript 5.8+ strict · TanStack Router + TanStack Query · Radix primitives + Tailwind CSS 4 · Vitest 3 + Testing Library + MSW 2 · Playwright.

## Global Constraints

- **Node 22**, **pnpm 10** (root workspace already exists per contracts §1 — do **not** create/modify root files; run every command from `dashboard/`).
- **TypeScript 5.8+ `strict`** (plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); `tsc --noEmit` must pass at every commit.
- **Vite 6**; dev server port **5173** with proxy `/api` and `/ingest` → `http://localhost:8080` (contracts §2).
- **Coverage floor 75% lines** (contracts §9), enforced via Vitest coverage thresholds.
- **RFC 7807** error shape everywhere: `{type, title, status, detail?, errors?}` (contracts §7).
- **Single-page static build** with runtime `config.js` → `window.__MYAMPMIX_CONFIG__ = { apiBaseUrl }`; one build deploys anywhere.
- **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`), scope `dashboard`.
- TDD for every task: write the failing test, watch it fail, implement, watch it pass, commit. DRY, YAGNI — nothing speculative beyond this phase.

---

### Task 1: Scaffold Vite + React + TypeScript strict app

**Files:**
- Create: `dashboard/package.json`, `dashboard/tsconfig.json`, `dashboard/vite.config.ts`, `dashboard/index.html`, `dashboard/public/config.js`, `dashboard/src/vite-env.d.ts`, `dashboard/src/index.css`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/test/setup.ts`, `dashboard/eslint.config.js`, `dashboard/.gitignore`
- Test: `dashboard/src/App.test.tsx`

**Interfaces:**
- Consumes: root pnpm workspace (`pnpm-workspace.yaml` already lists `dashboard`).
- Produces: `App` (named export, `src/App.tsx`); working `pnpm dev/build/test/typecheck` scripts; Tailwind 4 pipeline; Vitest + jsdom + coverage thresholds; dev proxy per contracts §2.

**Steps:**

- [ ] Create `dashboard/.gitignore`:

```gitignore
node_modules
dist
coverage
playwright-report
test-results
```

- [ ] Create `dashboard/package.json`:

```json
{
  "name": "@myampmix/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-toast": "^1.2.14",
    "@tanstack/react-query": "^5.80.0",
    "@tanstack/react-router": "^1.120.0",
    "clsx": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^3.3.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.28.0",
    "@playwright/test": "^1.52.0",
    "@tailwindcss/vite": "^4.1.8",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^18.3.20",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^4.5.0",
    "@vitest/coverage-v8": "^3.1.4",
    "eslint": "^9.28.0",
    "jsdom": "^26.1.0",
    "msw": "^2.8.4",
    "tailwindcss": "^4.1.8",
    "typescript": "~5.8.3",
    "typescript-eslint": "^8.33.0",
    "vite": "^6.3.5",
    "vitest": "^3.1.4"
  }
}
```

- [ ] Create `dashboard/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] Create `dashboard/vite.config.ts` (dev proxy per contracts §2; Vitest config with the 75% coverage floor):

```ts
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ingest': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/**/*.test.*', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 70,
      },
    },
  },
});
```

- [ ] Create `dashboard/eslint.config.js` (self-contained flat config; fold into the root ESLint 9 config by an `extends` once the root config lands):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

- [ ] Create `dashboard/index.html` — `config.js` **must** load before the module bundle:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MyAmpMix</title>
    <script src="/config.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] Create `dashboard/public/config.js` (runtime config template — copied verbatim into `dist/`, overwritten at deploy time):

```js
// MyAmpMix runtime configuration.
// This file is loaded before the app bundle and is REPLACED at deploy time —
// the same static build works against any backend origin.
window.__MYAMPMIX_CONFIG__ = {
  // '' = same origin (Vite dev proxy locally, reverse proxy in prod).
  // Or an absolute origin, e.g. 'https://api.myampmix.example'.
  apiBaseUrl: '',
};
```

- [ ] Create `dashboard/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] Create `dashboard/src/index.css` (Tailwind 4 + theme variables; the semantic tokens `bg`, `surface`, `border`, `text`, `text-muted`, `accent`, `accent-fg`, `danger` are the only colors the app may use):

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: oklch(98.5% 0.002 260);
  --surface: oklch(100% 0 0);
  --border: oklch(90% 0.004 260);
  --text: oklch(22% 0.01 260);
  --text-muted: oklch(50% 0.01 260);
  --accent: oklch(55% 0.18 265);
  --accent-fg: oklch(99% 0 0);
  --danger: oklch(55% 0.2 25);
}

.dark {
  --bg: oklch(18% 0.01 260);
  --surface: oklch(22% 0.01 260);
  --border: oklch(32% 0.01 260);
  --text: oklch(95% 0.005 260);
  --text-muted: oklch(70% 0.01 260);
  --accent: oklch(70% 0.15 265);
  --accent-fg: oklch(18% 0.01 260);
  --danger: oklch(65% 0.18 25);
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-danger: var(--danger);
}

body {
  @apply bg-bg text-text antialiased;
}
```

- [ ] Create `dashboard/src/test/setup.ts` (jest-dom + jsdom polyfills Radix needs; MSW wiring arrives in Task 7):

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

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

afterEach(() => {
  localStorage.clear();
});
```

- [ ] Run `pnpm install` in `dashboard/` (workspace root already exists; this only adds this package's deps to the workspace lockfile).
- [ ] Write the failing test `dashboard/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'MyAmpMix' })).toBeInTheDocument();
  });
});
```

- [ ] Run `pnpm vitest run src/App.test.tsx` — expect **FAIL** (cannot resolve `./App`).
- [ ] Create `dashboard/src/App.tsx` (placeholder — replaced with providers + router in Task 8):

```tsx
export function App() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">MyAmpMix</h1>
      <p className="mt-2 text-text-muted">Self-hosted product analytics.</p>
    </main>
  );
}
```

- [ ] Create `dashboard/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root missing in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] Run `pnpm vitest run src/App.test.tsx` — expect **PASS**.
- [ ] Run `pnpm typecheck` — expect clean.
- [ ] Commit: `feat(dashboard): scaffold vite react typescript app shell`

---

### Task 2: Runtime config loader

**Files:**
- Create: `dashboard/src/lib/config.ts`
- Test: `dashboard/src/lib/config.test.ts`

**Interfaces:**
- Consumes: `window.__MYAMPMIX_CONFIG__` set by `public/config.js` (Task 1).
- Produces: `RuntimeConfig` interface `{ apiBaseUrl: string }`, `getRuntimeConfig(): RuntimeConfig` — consumed by `apiFetch` (Task 7).

**Steps:**

- [ ] Write the failing test `dashboard/src/lib/config.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from './config';

describe('getRuntimeConfig', () => {
  afterEach(() => {
    delete window.__MYAMPMIX_CONFIG__;
  });

  it('returns values injected by config.js', () => {
    window.__MYAMPMIX_CONFIG__ = { apiBaseUrl: 'https://api.myampmix.example' };
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: 'https://api.myampmix.example' });
  });

  it('falls back to same-origin default when config.js is absent (dev)', () => {
    delete window.__MYAMPMIX_CONFIG__;
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '' });
  });

  it('fills missing keys from defaults', () => {
    window.__MYAMPMIX_CONFIG__ = {};
    expect(getRuntimeConfig().apiBaseUrl).toBe('');
  });
});
```

- [ ] Run `pnpm vitest run src/lib/config.test.ts` — expect **FAIL** (module not found).
- [ ] Create `dashboard/src/lib/config.ts`:

```ts
export interface RuntimeConfig {
  /** Backend origin. '' means same-origin (dev proxy / reverse-proxied prod). */
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __MYAMPMIX_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULTS: RuntimeConfig = {
  apiBaseUrl: '',
};

/** Merges the runtime config injected by /config.js over dev-safe defaults. */
export function getRuntimeConfig(): RuntimeConfig {
  return { ...DEFAULTS, ...window.__MYAMPMIX_CONFIG__ };
}
```

- [ ] Run `pnpm vitest run src/lib/config.test.ts` — expect **PASS**.
- [ ] Commit: `feat(dashboard): add runtime config loader with dev fallback`

---

### Task 3: Theme provider (light/dark, persisted)

**Files:**
- Create: `dashboard/src/lib/theme.tsx`
- Test: `dashboard/src/lib/theme.test.tsx`

**Interfaces:**
- Consumes: CSS variables + `.dark` class from `index.css` (Task 1); `localStorage`.
- Produces: `Theme` (`'light' | 'dark'`), `ThemeProvider`, `useTheme(): { theme: Theme; toggleTheme: () => void }` — consumed by `App` (Task 8) and `ThemeToggle` (Task 10).

**Steps:**

- [ ] Write the failing test `dashboard/src/lib/theme.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme';

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

describe('ThemeProvider', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light, toggles to dark, and persists the choice', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');

    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('myampmix-theme')).toBe('dark');
  });

  it('honours a stored preference on mount', () => {
    localStorage.setItem('myampmix-theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('throws when useTheme is used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow('useTheme must be used inside <ThemeProvider>');
  });
});
```

- [ ] Run `pnpm vitest run src/lib/theme.test.tsx` — expect **FAIL**.
- [ ] Create `dashboard/src/lib/theme.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'myampmix-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
```

- [ ] Run `pnpm vitest run src/lib/theme.test.tsx` — expect **PASS**.
- [ ] Commit: `feat(dashboard): add theme provider with persisted light/dark preference`

---

### Task 4: Base UI kit — Button, Input, Card, Dialog, Toast

**Files:**
- Create: `dashboard/src/lib/cn.ts`, `dashboard/src/components/ui/button.tsx`, `dashboard/src/components/ui/input.tsx`, `dashboard/src/components/ui/card.tsx`, `dashboard/src/components/ui/dialog.tsx`, `dashboard/src/components/ui/toast.tsx`
- Test: `dashboard/src/components/ui/ui-kit.test.tsx`

**Interfaces:**
- Consumes: `cn` helper, Radix `@radix-ui/react-dialog` / `@radix-ui/react-toast`, theme tokens.
- Produces: `Button` (+`ButtonProps`, variants `primary|secondary|ghost|danger`, sizes `sm|md`), `Input`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Dialog`/`DialogTrigger`/`DialogContent`/`DialogTitle`/`DialogDescription`/`DialogClose`, `ToastProvider`/`useToast(): { toast(options: ToastOptions): void }` with `ToastOptions { title, description?, variant? }` — consumed by Tasks 8–10.

**Steps:**

- [ ] Write the failing test `dashboard/src/components/ui/ui-kit.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog';
import { Input } from './input';
import { ToastProvider, useToast } from './toast';

describe('Button', () => {
  it('renders and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type=button and supports disabled', () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toBeDisabled();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger');
  });
});

describe('Input', () => {
  it('accepts typed text and forwards aria-invalid', async () => {
    render(<Input aria-label="Email" aria-invalid={true} />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.type(input, 'ada@example.com');
    expect(input).toHaveValue('ada@example.com');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Card', () => {
  it('renders header and content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Demo App</CardTitle>
        </CardHeader>
        <CardContent>Timezone: UTC</CardContent>
      </Card>,
    );
    expect(screen.getByText('Demo App')).toBeInTheDocument();
    expect(screen.getByText('Timezone: UTC')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('opens on trigger click and closes with the close button', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open settings</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>Manage SDK tokens.</DialogDescription>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Project settings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Toast', () => {
  function ToastProbe() {
    const { toast } = useToast();
    return (
      <Button onClick={() => toast({ title: 'Saved', description: 'Report saved.' })}>
        notify
      </Button>
    );
  }

  it('renders a toast when triggered', async () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Report saved.')).toBeInTheDocument();
  });

  it('throws when useToast is used outside the provider', () => {
    expect(() => render(<ToastProbe />)).toThrow('useToast must be used inside <ToastProvider>');
  });
});
```

- [ ] Run `pnpm vitest run src/components/ui/ui-kit.test.tsx` — expect **FAIL**.
- [ ] Create `dashboard/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] Create `dashboard/src/components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const variants = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-text hover:bg-bg',
  ghost: 'text-text hover:bg-border/40',
  danger: 'bg-danger text-accent-fg hover:opacity-90',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
```

- [ ] Create `dashboard/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text',
        'placeholder:text-text-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

- [ ] Create `dashboard/src/components/ui/card.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-6 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-2', className)} {...props} />;
}
```

- [ ] Create `dashboard/src/components/ui/dialog.tsx`:

```tsx
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
        'rounded-lg border border-border bg-surface p-6 shadow-lg',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-1 text-sm text-text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';
```

- [ ] Create `dashboard/src/components/ui/toast.tsx`:

```tsx
import * as ToastPrimitive from '@radix-ui/react-toast';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'error';
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    nextToastId += 1;
    const id = nextToastId;
    setToasts((current) => [...current, { ...options, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              'rounded-md border border-border bg-surface p-4 shadow-lg',
              item.variant === 'error' && 'border-danger',
            )}
          >
            <ToastPrimitive.Title className="text-sm font-medium">
              {item.title}
            </ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="mt-1 text-sm text-text-muted">
                {item.description}
              </ToastPrimitive.Description>
            )}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
```

- [ ] Run `pnpm vitest run src/components/ui/ui-kit.test.tsx` — expect **PASS**.
- [ ] Commit: `feat(dashboard): add base ui kit (button, input, card, dialog, toast)`

---

### Task 5: RFC 7807 problem parsing + ApiError

**Files:**
- Create: `dashboard/src/lib/api/problem.ts`
- Test: `dashboard/src/lib/api/problem.test.ts`

**Interfaces:**
- Consumes: contracts §7 error shape `{type, title, status, detail?, errors?}`.
- Produces: `ApiProblem` interface, `ApiError` class (with `.problem`), `problemFromResponse(res: Response): Promise<ApiProblem>` — consumed by `apiFetch` (Task 7) and forms (Task 9).

**Steps:**

- [ ] Write the failing test `dashboard/src/lib/api/problem.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, problemFromResponse } from './problem';

function jsonResponse(body: unknown, status: number, contentType = 'application/problem+json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('problemFromResponse', () => {
  it('parses a full RFC 7807 body', async () => {
    const problem = await problemFromResponse(
      jsonResponse(
        {
          type: 'https://myampmix.dev/problems/validation',
          title: 'Validation failed',
          status: 400,
          detail: 'Two fields are invalid.',
          errors: { email: ['must be a valid email'] },
        },
        400,
      ),
    );
    expect(problem).toEqual({
      type: 'https://myampmix.dev/problems/validation',
      title: 'Validation failed',
      status: 400,
      detail: 'Two fields are invalid.',
      errors: { email: ['must be a valid email'] },
    });
  });

  it('normalizes a minimal problem body', async () => {
    const problem = await problemFromResponse(
      jsonResponse({ type: 'about:blank', title: 'Unauthorized', status: 401 }, 401),
    );
    expect(problem.status).toBe(401);
    expect(problem.title).toBe('Unauthorized');
    expect(problem.detail).toBeUndefined();
  });

  it('falls back for non-JSON responses (e.g. proxy HTML)', async () => {
    const res = new Response('<html>Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/html' },
    });
    const problem = await problemFromResponse(res);
    expect(problem).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502 });
  });

  it('falls back for malformed JSON', async () => {
    const res = new Response('{not json', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'application/json' },
    });
    const problem = await problemFromResponse(res);
    expect(problem.status).toBe(500);
    expect(problem.title).toBe('Internal Server Error');
  });
});

describe('ApiError', () => {
  it('uses detail as message when present, otherwise title', () => {
    const withDetail = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Email already registered',
    });
    expect(withDetail.message).toBe('Email already registered');
    expect(withDetail.problem.status).toBe(409);
    expect(withDetail.name).toBe('ApiError');

    const withoutDetail = new ApiError({ type: 'about:blank', title: 'Unauthorized', status: 401 });
    expect(withoutDetail.message).toBe('Unauthorized');
  });
});
```

- [ ] Run `pnpm vitest run src/lib/api/problem.test.ts` — expect **FAIL**.
- [ ] Create `dashboard/src/lib/api/problem.ts`:

```ts
/** RFC 7807 problem details — the error shape of every MyAmpMix API response (contracts §7). */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

/** Normalize any non-2xx Response into an ApiProblem, tolerating non-JSON bodies. */
export async function problemFromResponse(res: Response): Promise<ApiProblem> {
  const fallback: ApiProblem = {
    type: 'about:blank',
    title: res.statusText || 'Request failed',
    status: res.status,
  };

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return fallback;

  try {
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return fallback;
    const raw = body as Record<string, unknown>;
    const problem: ApiProblem = {
      type: typeof raw.type === 'string' ? raw.type : 'about:blank',
      title: typeof raw.title === 'string' ? raw.title : fallback.title,
      status: typeof raw.status === 'number' ? raw.status : res.status,
    };
    if (typeof raw.detail === 'string') problem.detail = raw.detail;
    if (typeof raw.errors === 'object' && raw.errors !== null) {
      problem.errors = raw.errors as Record<string, string[]>;
    }
    return problem;
  } catch {
    return fallback;
  }
}
```

- [ ] Run `pnpm vitest run src/lib/api/problem.test.ts` — expect **PASS**.
- [ ] Commit: `feat(dashboard): add rfc 7807 problem parsing and ApiError`

---

### Task 6: In-memory auth store

**Files:**
- Create: `dashboard/src/lib/api/types.ts`, `dashboard/src/features/auth/store.ts`
- Test: `dashboard/src/features/auth/store.test.ts`

**Interfaces:**
- Consumes: contracts §7 auth conventions (access JWT in memory only).
- Produces: API types `AuthUser`, `AuthResponse`, `LoginRequest`, `SignupRequest`, `Project`, `ListProjectsResponse`; `AuthState { accessToken, user, status: 'unknown'|'authenticated'|'anonymous' }`; `authStore` (`getState`, `subscribe`, `setSession`, `clearSession`, `reset`); `useAuth(): AuthState` hook — consumed by Tasks 7–10.

**Steps:**

- [ ] Create `dashboard/src/lib/api/types.ts` — hand-written from contracts §7 (**assumption documented in the design spec §14**: replaced by OpenAPI-generated types, same names, when the backend spec generation lands):

```ts
// API types per shared contracts §7 (and design spec §14 assumptions).
// Hand-written for phase 1; to be replaced by OpenAPI-generated types with identical names.

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}
```

- [ ] Write the failing test `dashboard/src/features/auth/store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from './store';

const user = { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' };

describe('authStore', () => {
  beforeEach(() => {
    authStore.reset();
  });

  it('starts unknown with no token', () => {
    expect(authStore.getState()).toEqual({ accessToken: null, user: null, status: 'unknown' });
  });

  it('setSession stores token and user in memory and notifies subscribers', () => {
    const listener = vi.fn();
    authStore.subscribe(listener);
    authStore.setSession('token-123', user);
    expect(authStore.getState()).toEqual({
      accessToken: 'token-123',
      user,
      status: 'authenticated',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    // Never persisted — memory only (contracts §7).
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clearSession marks the visitor anonymous', () => {
    authStore.setSession('token-123', user);
    authStore.clearSession();
    expect(authStore.getState()).toEqual({ accessToken: null, user: null, status: 'anonymous' });
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = authStore.subscribe(listener);
    unsubscribe();
    authStore.setSession('token-123', user);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `pnpm vitest run src/features/auth/store.test.ts` — expect **FAIL**.
- [ ] Create `dashboard/src/features/auth/store.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { AuthUser } from '../../lib/api/types';

export interface AuthState {
  /** Access JWT — memory only, never persisted (contracts §7). */
  accessToken: string | null;
  user: AuthUser | null;
  /** 'unknown' until the first silent-refresh attempt resolves after page load. */
  status: 'unknown' | 'authenticated' | 'anonymous';
}

const INITIAL_STATE: AuthState = { accessToken: null, user: null, status: 'unknown' };

let state: AuthState = INITIAL_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const authStore = {
  getState(): AuthState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setSession(accessToken: string, user: AuthUser): void {
    state = { accessToken, user, status: 'authenticated' };
    emit();
  },
  clearSession(): void {
    state = { accessToken: null, user: null, status: 'anonymous' };
    emit();
  },
  /** Back to the fresh-page-load state ('unknown'). Used by tests and full logout-reload paths. */
  reset(): void {
    state = INITIAL_STATE;
    emit();
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState);
}
```

- [ ] Run `pnpm vitest run src/features/auth/store.test.ts` — expect **PASS**.
- [ ] Commit: `feat(dashboard): add in-memory auth store`

---

### Task 7: MSW harness + typed fetch client with 401 silent-refresh-and-replay

**Files:**
- Create: `dashboard/src/test/msw/handlers.ts`, `dashboard/src/test/msw/server.ts`, `dashboard/src/lib/api/client.ts`
- Modify: `dashboard/src/test/setup.ts`
- Test: `dashboard/src/lib/api/client.test.ts`

**Interfaces:**
- Consumes: `getRuntimeConfig` (Task 2), `ApiError`/`problemFromResponse` (Task 5), `authStore` + types (Task 6); contracts §7 auth endpoints.
- Produces: `apiFetch<T>(path, options?)`, `refreshSession(): Promise<boolean>`, `restoreSession(): Promise<boolean>`; MSW `handlers`, `server`, and test fixtures `TEST_USER`, `TEST_PASSWORD`, `VALID_ACCESS_TOKEN`, `REFRESHED_ACCESS_TOKEN`, `authState`, `resetAuthState` — consumed by Tasks 8–11.

**Steps:**

- [ ] Create `dashboard/src/test/msw/handlers.ts` — one mock source of truth implementing contracts §7 (used by node tests, the dev worker, and Playwright):

```ts
import { http, HttpResponse } from 'msw';
import type { AuthResponse, AuthUser, ListProjectsResponse } from '../../lib/api/types';

export const TEST_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
};
export const TEST_PASSWORD = 'correct-horse-9';
export const VALID_ACCESS_TOKEN = 'valid-access-token';
export const REFRESHED_ACCESS_TOKEN = 'refreshed-access-token';

/** Mutable mock-server state; reset between tests via resetAuthState(). */
export const authState = {
  /** Simulates whether the browser holds a valid httpOnly refresh cookie. */
  refreshValid: false,
  refreshCalls: 0,
  knownEmails: new Set<string>([TEST_USER.email]),
};

export function resetAuthState(): void {
  authState.refreshValid = false;
  authState.refreshCalls = 0;
  authState.knownEmails = new Set([TEST_USER.email]);
}

function problem(status: number, title: string, extra?: Record<string, unknown>) {
  return HttpResponse.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const ACCEPTED_TOKENS = new Set([VALID_ACCESS_TOKEN, REFRESHED_ACCESS_TOKEN]);

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (body.email === TEST_USER.email && body.password === TEST_PASSWORD) {
      authState.refreshValid = true; // server Set-Cookie's the refresh token
      const response: AuthResponse = { access_token: VALID_ACCESS_TOKEN, user: TEST_USER };
      return HttpResponse.json(response);
    }
    return problem(401, 'Invalid email or password');
  }),

  http.post('/api/v1/auth/signup', async ({ request }) => {
    const body = (await request.json()) as { name?: string; email?: string; password?: string };
    if (!body.email || !body.password || !body.name) {
      return problem(400, 'Validation failed', {
        errors: { email: ['required'], password: ['required'], name: ['required'] },
      });
    }
    if (authState.knownEmails.has(body.email)) {
      return problem(409, 'Email already registered');
    }
    authState.knownEmails.add(body.email);
    authState.refreshValid = true;
    const response: AuthResponse = {
      access_token: VALID_ACCESS_TOKEN,
      user: { ...TEST_USER, email: body.email, name: body.name },
    };
    return HttpResponse.json(response); // 200, per contracts §7 (same as login/refresh)
  }),

  http.post('/api/v1/auth/refresh', () => {
    authState.refreshCalls += 1;
    if (!authState.refreshValid) return problem(401, 'Refresh token invalid or expired');
    const response: AuthResponse = { access_token: REFRESHED_ACCESS_TOKEN, user: TEST_USER };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/logout', () => {
    authState.refreshValid = false;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/projects', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const response: ListProjectsResponse = {
      projects: [
        {
          id: '0197f6a0-0000-7000-8000-0000000000aa',
          org_id: '0197f6a0-0000-7000-8000-0000000000bb',
          name: 'Demo App',
          timezone: 'UTC',
        },
      ],
    };
    return HttpResponse.json(response);
  }),
];
```

- [ ] Create `dashboard/src/test/msw/server.ts`:

```ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

- [ ] Modify `dashboard/src/test/setup.ts` to the final version (adds MSW lifecycle + store reset):

```ts
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
```

- [ ] Write the failing test `dashboard/src/lib/api/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import {
  authState,
  REFRESHED_ACCESS_TOKEN,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../test/msw/handlers';
import { apiFetch, restoreSession } from './client';
import { ApiError } from './problem';
import type { ListProjectsResponse } from './types';

describe('apiFetch', () => {
  it('injects the Authorization header from the auth store', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    const result = await apiFetch<ListProjectsResponse>('/api/v1/projects');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe('Demo App');
  });

  it('throws ApiError with the parsed problem on non-2xx auth-endpoint responses', async () => {
    await expect(
      apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'wrong' },
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      problem: { status: 401, title: 'Invalid email or password' },
    });
  });

  it('silently refreshes and replays the original request on 401', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = true;

    const result = await apiFetch<ListProjectsResponse>('/api/v1/projects');

    expect(result.projects).toHaveLength(1);
    expect(authState.refreshCalls).toBe(1);
    expect(authStore.getState().accessToken).toBe(REFRESHED_ACCESS_TOKEN);
  });

  it('single-flights concurrent refreshes', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = true;

    const [a, b] = await Promise.all([
      apiFetch<ListProjectsResponse>('/api/v1/projects'),
      apiFetch<ListProjectsResponse>('/api/v1/projects'),
    ]);

    expect(a.projects).toHaveLength(1);
    expect(b.projects).toHaveLength(1);
    expect(authState.refreshCalls).toBe(1);
  });

  it('clears the session and throws when the refresh itself fails', async () => {
    authStore.setSession('expired-access-token', TEST_USER);
    authState.refreshValid = false;

    await expect(apiFetch('/api/v1/projects')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });

  it('returns undefined for 204 responses', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    await expect(apiFetch<void>('/api/v1/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('restoreSession', () => {
  it('authenticates from the refresh cookie on page load', async () => {
    authState.refreshValid = true;
    await expect(restoreSession()).resolves.toBe(true);
    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: REFRESHED_ACCESS_TOKEN,
      user: TEST_USER,
    });
  });

  it('marks the visitor anonymous when no valid refresh cookie exists', async () => {
    authState.refreshValid = false;
    await expect(restoreSession()).resolves.toBe(false);
    expect(authStore.getState().status).toBe('anonymous');
  });
});
```

- [ ] Run `pnpm vitest run src/lib/api/client.test.ts` — expect **FAIL** (client module missing).
- [ ] Create `dashboard/src/lib/api/client.ts`:

```ts
import { authStore } from '../../features/auth/store';
import { getRuntimeConfig } from '../config';
import { ApiError, problemFromResponse } from './problem';
import type { AuthResponse } from './types';

export interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** JSON-serializable request body. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Auth endpoints are never themselves refresh-retried. */
const AUTH_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
  '/api/v1/auth/refresh',
]);

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${getRuntimeConfig().apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthResponse;
    authStore.setSession(body.access_token, body.user);
    return true;
  } catch {
    return false;
  }
}

/** Single-flight silent refresh: concurrent callers share one /auth/refresh round-trip. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Page-load session restore from the httpOnly refresh cookie. */
export async function restoreSession(): Promise<boolean> {
  const refreshed = await refreshSession();
  if (!refreshed) authStore.clearSession();
  return refreshed;
}

function send(path: string, options: ApiFetchOptions): Promise<Response> {
  const { body, headers, ...init } = options;
  const token = authStore.getState().accessToken;
  return fetch(`${getRuntimeConfig().apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(await problemFromResponse(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Typed transport for every API call:
 * runtime base URL + credentials + bearer injection + RFC 7807 errors +
 * 401 silent-refresh-and-replay (exactly one replay; auth endpoints excluded).
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      authStore.clearSession();
      throw new ApiError(await problemFromResponse(res));
    }
    return parse<T>(await send(path, options));
  }
  return parse<T>(res);
}
```

- [ ] Run `pnpm vitest run src/lib/api/client.test.ts` — expect **PASS**.
- [ ] Run `pnpm vitest run` (full suite) — expect **PASS** (earlier suites unaffected by the new setup file).
- [ ] Commit: `feat(dashboard): add typed api client with silent refresh and msw test harness`

---

### Task 8: Router with auth guards, placeholder pages, error boundary, not-found

**Files:**
- Create: `dashboard/src/router.tsx`, `dashboard/src/components/ErrorBoundary.tsx`, `dashboard/src/components/NotFoundPage.tsx`, `dashboard/src/components/RouteErrorPage.tsx`, `dashboard/src/components/layout/AppLayout.tsx` (minimal — expanded in Task 10), `dashboard/src/features/auth/components/LoginPage.tsx` (placeholder — form in Task 9), `dashboard/src/features/auth/components/SignupPage.tsx` (placeholder), `dashboard/src/features/auth/components/InvitePage.tsx`, `dashboard/src/features/projects/api.ts`, `dashboard/src/features/projects/components/ProjectsPage.tsx`, `dashboard/src/features/projects/components/ProjectPlaceholderPage.tsx`, `dashboard/src/test/render-app.tsx`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/App.test.tsx`
- Test: `dashboard/src/router.test.tsx`

**Interfaces:**
- Consumes: `restoreSession` (Task 7), `authStore`/`useAuth` (Task 6), UI kit (Task 4), `ThemeProvider` (Task 3), `apiFetch` + `ListProjectsResponse` (Tasks 6–7).
- Produces: `routeTree`, `router` (routes: `/` → redirect, `/login` [+`redirect` search param], `/signup`, `/invite/$token`, private layout `id: 'private'` wrapping `/projects` and `/projects/$projectId`); `ErrorBoundary`, `NotFoundPage`, `RouteErrorPage`, `AppLayout`, `useProjects()`, `renderApp(url)` test harness — consumed by Tasks 9–11.

**Steps:**

- [ ] Write the failing test `dashboard/src/router.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authState } from './test/msw/handlers';
import { renderApp } from './test/render-app';

describe('router', () => {
  it('redirects anonymous visitors from a private route to /login', async () => {
    authState.refreshValid = false; // no refresh cookie
    const { router } = renderApp('/projects');
    expect(
      await screen.findByRole('heading', { name: 'Log in to MyAmpMix' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/projects' });
  });

  it('restores the session from the refresh cookie and shows projects', async () => {
    authState.refreshValid = true; // valid refresh cookie survives a reload
    renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
  });

  it('redirects / to /projects (then to login when anonymous)', async () => {
    authState.refreshValid = false;
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('keeps authenticated users away from /login', async () => {
    authState.refreshValid = true;
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(router.state.location.pathname).toBe('/projects');
  });

  it('renders the invite placeholder with the token from the path', async () => {
    renderApp('/invite/tok_abc123');
    expect(await screen.findByText(/tok_abc123/)).toBeInTheDocument();
  });

  it('shows the project placeholder for /projects/:id', async () => {
    authState.refreshValid = true;
    renderApp('/projects/0197f6a0-0000-7000-8000-0000000000aa');
    expect(await screen.findByText(/later milestones/i)).toBeInTheDocument();
  });

  it('renders not-found for unknown urls', async () => {
    renderApp('/definitely-not-a-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
```

- [ ] Run `pnpm vitest run src/router.test.tsx` — expect **FAIL** (modules missing).
- [ ] Create `dashboard/src/components/ErrorBoundary.tsx` (deliberately avoids the UI kit so the crash path has no dependencies):

```tsx
import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-center text-text-muted">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
            onClick={() => window.location.assign('/')}
          >
            Reload MyAmpMix
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
```

- [ ] Create `dashboard/src/components/NotFoundPage.tsx`:

```tsx
import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-text-muted">The page you are looking for does not exist.</p>
      <Link to="/projects" className="text-accent underline">
        Back to projects
      </Link>
    </main>
  );
}
```

- [ ] Create `dashboard/src/components/RouteErrorPage.tsx`:

```tsx
import { Button } from './ui/button';

export function RouteErrorPage({ error }: { error: Error }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-center text-text-muted">{error.message}</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </main>
  );
}
```

- [ ] Create `dashboard/src/components/layout/AppLayout.tsx` (minimal shell — sidebar contents arrive in Task 10):

```tsx
import { Outlet } from '@tanstack/react-router';

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r border-border bg-surface p-4" aria-label="Primary">
        <div className="text-lg font-semibold">MyAmpMix</div>
      </aside>
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] Create `dashboard/src/features/auth/components/LoginPage.tsx` (placeholder — the form is Task 9):

```tsx
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in to MyAmpMix</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">Login form coming in the next task.</p>
          <p className="mt-4 text-sm text-text-muted">
            No account?{' '}
            <Link to="/signup" className="text-accent underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Create `dashboard/src/features/auth/components/SignupPage.tsx` (placeholder — the form is Task 9):

```tsx
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your MyAmpMix account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">Signup form coming in the next task.</p>
          <p className="mt-4 text-sm text-text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Create `dashboard/src/features/auth/components/InvitePage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            Invitation acceptance ships with the Auth &amp; Tenancy milestone. Your invite token{' '}
            <code className="rounded bg-bg px-1">{token}</code> was recognised — check back soon.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Create `dashboard/src/features/projects/api.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type { ListProjectsResponse } from '../../lib/api/types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ListProjectsResponse>('/api/v1/projects'),
  });
}
```

- [ ] Create `dashboard/src/features/projects/components/ProjectsPage.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import { useProjects } from '../api';

export function ProjectsPage() {
  const { data, isPending, error } = useProjects();

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Projects</h1>
      {isPending && <p role="status">Loading projects…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load projects'}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {data?.projects.map((project) => (
          <Link
            key={project.id}
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Card className="h-full transition-colors hover:border-accent">
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-muted">Timezone: {project.timezone}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {data && data.projects.length === 0 && (
        <p className="text-text-muted">No projects yet.</p>
      )}
    </section>
  );
}
```

- [ ] Create `dashboard/src/features/projects/components/ProjectPlaceholderPage.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function ProjectPlaceholderPage() {
  const { projectId } = useParams({ from: '/projects/$projectId' });
  return (
    <section>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Analytics coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            Live feed, insights, funnels, retention, flows, users, cohorts and dashboards for
            project <code className="rounded bg-bg px-1">{projectId}</code> arrive in later
            milestones (design spec §13).
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
```

- [ ] Create `dashboard/src/router.tsx`:

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppLayout } from './components/layout/AppLayout';
import { NotFoundPage } from './components/NotFoundPage';
import { RouteErrorPage } from './components/RouteErrorPage';
import { InvitePage } from './features/auth/components/InvitePage';
import { LoginPage } from './features/auth/components/LoginPage';
import { SignupPage } from './features/auth/components/SignupPage';
import { authStore } from './features/auth/store';
import { ProjectPlaceholderPage } from './features/projects/components/ProjectPlaceholderPage';
import { ProjectsPage } from './features/projects/components/ProjectsPage';
import { restoreSession } from './lib/api/client';

/** Resolve the session exactly once per page load before any guarded navigation. */
async function ensureAuthResolved(): Promise<void> {
  if (authStore.getState().status === 'unknown') await restoreSession();
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  beforeLoad: async () => {
    await ensureAuthResolved();
    if (authStore.getState().status === 'authenticated') throw redirect({ to: '/projects' });
  },
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: async () => {
    await ensureAuthResolved();
    if (authStore.getState().status === 'authenticated') throw redirect({ to: '/projects' });
  },
  component: SignupPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InvitePage,
});

const privateRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'private',
  beforeLoad: async ({ location }) => {
    await ensureAuthResolved();
    if (authStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

const projectsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects',
  component: ProjectsPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId',
  component: ProjectPlaceholderPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  inviteRoute,
  privateRoute.addChildren([projectsRoute, projectDetailRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] Create `dashboard/src/test/render-app.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { ToastProvider } from '../components/ui/toast';
import { ThemeProvider } from '../lib/theme';
import { routeTree } from '../router';

/** Mount the real route tree at a URL with fresh providers and memory history. */
export function renderApp(initialUrl: string) {
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createRouter({ routeTree, history });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { router };
}
```

- [ ] Modify `dashboard/src/App.tsx` to the final provider composition:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/toast';
import { ApiError } from './lib/api/problem';
import { ThemeProvider } from './lib/theme';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Never retry 4xx problems; one retry for transient failures.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.problem.status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
```

- [ ] Modify `dashboard/src/App.test.tsx` — the app now boots into the router (anonymous → login):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('boots to the login page when no session exists', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Log in to MyAmpMix' }),
    ).toBeInTheDocument();
  });
});
```

- [ ] Run `pnpm vitest run src/router.test.tsx src/App.test.tsx` — expect **PASS**.
- [ ] Run `pnpm vitest run` and `pnpm typecheck` — expect **PASS**/clean.
- [ ] Commit: `feat(dashboard): add router with auth guards, placeholder pages and error boundary`

---

### Task 9: Auth feature — login & signup forms with validation

**Files:**
- Create: `dashboard/src/features/auth/validation.ts`, `dashboard/src/features/auth/api.ts`, `dashboard/src/features/auth/components/LoginForm.tsx`, `dashboard/src/features/auth/components/SignupForm.tsx`
- Modify: `dashboard/src/features/auth/components/LoginPage.tsx`, `dashboard/src/features/auth/components/SignupPage.tsx`
- Test: `dashboard/src/features/auth/validation.test.ts`, `dashboard/src/features/auth/components/auth-forms.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 7), `authStore` (Task 6), UI kit + `useToast` (Task 4), router search param `redirect` (Task 8), MSW fixtures (Task 7).
- Produces: `FieldErrors`, `validateLogin`, `validateSignup`; auth API `login(input: LoginRequest)`, `signup(input: SignupRequest)`, `logout()`; `LoginForm`, `SignupForm` — `logout` consumed by Task 10.

**Steps:**

- [ ] Write the failing test `dashboard/src/features/auth/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateLogin, validateSignup } from './validation';

describe('validateLogin', () => {
  it('requires email and password', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    });
  });

  it('rejects malformed emails', () => {
    expect(validateLogin({ email: 'not-an-email', password: 'x' })).toEqual({
      email: 'Enter a valid email address',
    });
  });

  it('passes valid input', () => {
    expect(validateLogin({ email: 'ada@example.com', password: 'correct-horse-9' })).toEqual({});
  });
});

describe('validateSignup', () => {
  it('requires name and a password of at least 8 characters', () => {
    expect(validateSignup({ name: '  ', email: 'ada@example.com', password: 'short' })).toEqual({
      name: 'Name is required',
      password: 'Password must be at least 8 characters',
    });
  });

  it('passes valid input', () => {
    expect(
      validateSignup({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse-9' }),
    ).toEqual({});
  });
});
```

- [ ] Write the failing test `dashboard/src/features/auth/components/auth-forms.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../store';
import { TEST_PASSWORD, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

describe('LoginForm', () => {
  it('shows field errors on empty submit', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('shows the problem title inline on invalid credentials', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(authStore.getState().status).not.toBe('authenticated');
  });

  it('logs in, stores the session in memory, and lands on projects', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: VALID_ACCESS_TOKEN,
    });
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('honours the ?redirect= search param after login', async () => {
    const { router } = renderApp(
      '/login?redirect=%2Fprojects%2F0197f6a0-0000-7000-8000-0000000000aa',
    );
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByText(/later milestones/i);
    expect(router.state.location.pathname).toBe(
      '/projects/0197f6a0-0000-7000-8000-0000000000aa',
    );
  });
});

describe('SignupForm', () => {
  it('shows an inline conflict message when the email is taken', async () => {
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpMix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });

  it('signs up a new user and lands on projects', async () => {
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpMix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(authStore.getState().user?.email).toBe('grace@example.com');
  });
});
```

- [ ] Run `pnpm vitest run src/features/auth` — expect **FAIL**.
- [ ] Create `dashboard/src/features/auth/validation.ts`:

```ts
export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(values: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address';
  if (!values.password) errors.password = 'Password is required';
  return errors;
}

export function validateSignup(values: {
  name: string;
  email: string;
  password: string;
}): FieldErrors {
  const errors = validateLogin(values);
  if (!values.name.trim()) errors.name = 'Name is required';
  if (values.password && values.password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  }
  return errors;
}
```

- [ ] Create `dashboard/src/features/auth/api.ts`:

```ts
import { apiFetch } from '../../lib/api/client';
import type { AuthResponse, LoginRequest, SignupRequest } from '../../lib/api/types';
import { authStore } from './store';

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const response = await apiFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: input,
  });
  authStore.setSession(response.access_token, response.user);
  return response;
}

export async function signup(input: SignupRequest): Promise<AuthResponse> {
  const response = await apiFetch<AuthResponse>('/api/v1/auth/signup', {
    method: 'POST',
    body: input,
  });
  authStore.setSession(response.access_token, response.user);
  return response;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    // The local session dies even if the server call fails.
    authStore.clearSession();
  }
}
```

- [ ] Create `dashboard/src/features/auth/components/LoginForm.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { login } from '../api';
import { validateLogin, type FieldErrors } from '../validation';

export function LoginForm() {
  const router = useRouter();
  const search = useSearch({ from: '/login' });
  const { toast } = useToast();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      router.history.push(search.redirect ?? '/projects');
    },
    onError: (error: Error) => {
      // 4xx problems render inline below; unexpected failures get a toast.
      if (!(error instanceof ApiError) || error.problem.status >= 500) {
        toast({
          title: 'Login failed',
          description: 'Something went wrong. Please try again.',
          variant: 'error',
        });
      }
    },
  });

  const inlineError =
    mutation.error instanceof ApiError && mutation.error.problem.status < 500
      ? mutation.error.problem.title
      : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateLogin(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="login-email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(fieldErrors.email)}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
        {fieldErrors.email && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="login-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          aria-invalid={Boolean(fieldErrors.password)}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
        {fieldErrors.password && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.password}
          </p>
        )}
      </div>
      {inlineError && (
        <p role="alert" className="text-sm text-danger">
          {inlineError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
```

- [ ] Create `dashboard/src/features/auth/components/SignupForm.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { signup } from '../api';
import { validateSignup, type FieldErrors } from '../validation';

export function SignupForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: () => {
      router.history.push('/projects');
    },
    onError: (error: Error) => {
      if (!(error instanceof ApiError) || error.problem.status >= 500) {
        toast({
          title: 'Signup failed',
          description: 'Something went wrong. Please try again.',
          variant: 'error',
        });
      }
    },
  });

  const inlineError =
    mutation.error instanceof ApiError && mutation.error.problem.status < 500
      ? mutation.error.problem.title
      : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateSignup(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="signup-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <Input
          id="signup-name"
          autoComplete="name"
          value={values.name}
          aria-invalid={Boolean(fieldErrors.name)}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
        {fieldErrors.name && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="signup-email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(fieldErrors.email)}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
        {fieldErrors.email && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="signup-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          aria-invalid={Boolean(fieldErrors.password)}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
        {fieldErrors.password && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.password}
          </p>
        )}
      </div>
      {inlineError && (
        <p role="alert" className="text-sm text-danger">
          {inlineError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
```

- [ ] Modify `dashboard/src/features/auth/components/LoginPage.tsx` to embed the form:

```tsx
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { LoginForm } from './LoginForm';

export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in to MyAmpMix</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="mt-4 text-sm text-text-muted">
            No account?{' '}
            <Link to="/signup" className="text-accent underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Modify `dashboard/src/features/auth/components/SignupPage.tsx` to embed the form:

```tsx
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SignupForm } from './SignupForm';

export function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your MyAmpMix account</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm />
          <p className="mt-4 text-sm text-text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Run `pnpm vitest run src/features/auth` — expect **PASS**.
- [ ] Run `pnpm vitest run` and `pnpm typecheck` — expect **PASS**/clean.
- [ ] Commit: `feat(dashboard): add login and signup forms with validation`

---

### Task 10: App layout — sidebar nav, project switcher stub, theme toggle, logout

**Files:**
- Create: `dashboard/src/components/layout/ProjectSwitcher.tsx`, `dashboard/src/components/layout/ThemeToggle.tsx`
- Modify: `dashboard/src/components/layout/AppLayout.tsx`
- Test: `dashboard/src/components/layout/app-layout.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 6), `logout` (Task 9), `useTheme` (Task 3), `Button` (Task 4), router `Link`/`Outlet`/`useRouter` (Task 8), `renderApp` (Task 8).
- Produces: full `AppLayout`, `ProjectSwitcher` (stub), `ThemeToggle` — the shell every private page renders inside.

**Steps:**

- [ ] Write the failing test `dashboard/src/components/layout/app-layout.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import { authState, TEST_USER } from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

describe('AppLayout', () => {
  it('shows navigation, the project switcher stub, and the signed-in user', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All projects/ })).toBeDisabled();
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
  });

  it('toggles the theme from the sidebar and persists it', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('myampmix-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    document.documentElement.classList.remove('dark');
  });

  it('logs out, clears the in-memory session, and returns to login', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(
      await screen.findByRole('heading', { name: 'Log in to MyAmpMix' }),
    ).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });
});
```

- [ ] Run `pnpm vitest run src/components/layout/app-layout.test.tsx` — expect **FAIL**.
- [ ] Create `dashboard/src/components/layout/ProjectSwitcher.tsx`:

```tsx
import { Button } from '../ui/button';

/** Stub: becomes a real Radix listbox when multi-project navigation lands (milestone 2). */
export function ProjectSwitcher() {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full justify-between"
      disabled
      title="Project switching arrives with the tenancy milestone"
    >
      All projects <span aria-hidden>▾</span>
    </Button>
  );
}
```

- [ ] Create `dashboard/src/components/layout/ThemeToggle.tsx`:

```tsx
import { useTheme } from '../../lib/theme';
import { Button } from '../ui/button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={toggleTheme}
      aria-pressed={theme === 'dark'}
    >
      {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    </Button>
  );
}
```

- [ ] Modify `dashboard/src/components/layout/AppLayout.tsx` to the full version:

```tsx
import { Link, Outlet, useRouter } from '@tanstack/react-router';
import { logout } from '../../features/auth/api';
import { useAuth } from '../../features/auth/store';
import { Button } from '../ui/button';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThemeToggle } from './ThemeToggle';

const UPCOMING_SECTIONS = [
  'Insights',
  'Funnels',
  'Retention',
  'Flows',
  'Users',
  'Cohorts',
  'Dashboards',
] as const;

export function AppLayout() {
  const { user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout(); // clears the session even on server failure
    router.history.push('/login');
  };

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="flex w-60 flex-col border-r border-border bg-surface p-4">
        <div className="mb-6 text-lg font-semibold">MyAmpMix</div>
        <ProjectSwitcher />
        <nav aria-label="Primary" className="mt-6 flex-1">
          <Link
            to="/projects"
            className="block rounded-md px-3 py-2 text-sm hover:bg-border/40 [&.active]:bg-border/40 [&.active]:font-medium"
          >
            Projects
          </Link>
          <ul aria-label="Coming soon" className="mt-4 space-y-1 text-sm text-text-muted">
            {UPCOMING_SECTIONS.map((section) => (
              <li key={section} className="px-3 py-1">
                {section} <span className="text-xs">(soon)</span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto space-y-2 border-t border-border pt-4">
          <ThemeToggle />
          <div className="truncate px-3 text-xs text-text-muted">{user?.email}</div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => void handleLogout()}
          >
            Log out
          </Button>
        </div>
      </aside>
      <main id="main-content" className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] Run `pnpm vitest run src/components/layout/app-layout.test.tsx` — expect **PASS**.
- [ ] Run `pnpm vitest run` and `pnpm typecheck` — expect **PASS**/clean.
- [ ] Commit: `feat(dashboard): add app layout with sidebar, project switcher stub and theme toggle`

---

### Task 11: Playwright smoke e2e + production build verification

**Files:**
- Create: `dashboard/playwright.config.ts`, `dashboard/e2e/smoke.spec.ts`, `dashboard/src/test/msw/browser.ts`, `dashboard/public/mockServiceWorker.js` (generated by `msw init`)
- Modify: `dashboard/src/main.tsx`
- Test: `dashboard/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: MSW `handlers` + fixtures (Task 7), full app (Tasks 8–10), `pnpm build` pipeline (Task 1).
- Produces: `worker` (MSW browser worker, started only in dev builds (`import.meta.env.DEV`) with `VITE_ENABLE_MSW=true`); CI-runnable `pnpm e2e` (runs against `vite dev`, not a production preview); verified `dist/` (single-page + `config.js` template).

**Steps:**

- [ ] Run `pnpm exec msw init public --save` — generates `dashboard/public/mockServiceWorker.js` (committed; only fetched when the worker is enabled).
- [ ] Create `dashboard/src/test/msw/browser.ts`:

```ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

- [ ] Modify `dashboard/src/main.tsx` — start MSW before render only in dev builds with the flag set. Guard on `import.meta.env.DEV` (not on `VITE_ENABLE_MSW` alone): Vite always statically replaces `import.meta.env.DEV` with the literal `false` in production builds — unlike a custom env var such as `VITE_ENABLE_MSW`, which is not reliably define-replaced when unset — so with the `DEV &&` guard Rollup can prove the branch is dead in production and drops it along with its dynamic-import chunk:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'true') {
    const { worker } = await import('./test/msw/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Root container #root missing in index.html');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
```

- [ ] Create `dashboard/playwright.config.ts` (boots the app against MSW via the **Vite dev server** — no backend needed. This must stay `vite dev`, not a `vite build` + `vite preview` of the production bundle: `import.meta.env.DEV` is only `true` under `vite dev`/`vite`, which is what lets the `bootstrap()` guard above start the MSW worker here while still being dead-code-eliminated from the production build asserted against in the build-verification step below):

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    env: { VITE_ENABLE_MSW: 'true' },
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] Write the failing smoke test `dashboard/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('boots, logs in, and lands on the projects page', async ({ page }) => {
  await page.goto('/');

  // Anonymous visitor is redirected to login by the auth guard.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Log in to MyAmpMix' })).toBeVisible();

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Demo App')).toBeVisible();
});

test('shows inline error for bad credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] Run `pnpm exec playwright install chromium` (first run only), then `pnpm e2e` — expect **FAIL** until the MSW worker wiring above is complete, then **PASS** (if wiring was done first, verify failure by temporarily unsetting `VITE_ENABLE_MSW` in the config — the login request must fail — then restore it).
- [ ] Verify the production build (single-page static output + runtime config template):

```sh
pnpm build
test -f dist/index.html
test -f dist/config.js
grep -q '__MYAMPMIX_CONFIG__' dist/config.js
grep -q '<script src="/config.js"></script>' dist/index.html
# exactly one HTML entry point (SPA)
[ "$(find dist -name '*.html' | wc -l | tr -d ' ')" = "1" ]
# no MSW worker code in the production bundle
! grep -rq 'mockServiceWorker' dist/assets
```

All assertions must pass. (`dist/mockServiceWorker.js` will exist because everything in `public/` is copied — that is acceptable: it is inert unless a page registers it, and the register call is compiled out. If you want it gone, delete it in the deploy pipeline, not here.)

- [ ] Run the full gate: `pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm e2e` — expect all **PASS** with coverage ≥ 75% lines.
- [ ] Commit: `test(dashboard): add playwright smoke e2e and production build verification`

---

## Done Criteria (phase exit)

- `pnpm build` in `dashboard/` produces a static `dist/` with a single `index.html` and an editable `config.js` runtime template — the same artifact deploys against any backend origin.
- `pnpm test:coverage` passes with ≥ 75% lines; `pnpm e2e` passes with no backend running (MSW).
- Login/signup work end-to-end against the contracts §7 mock: in-memory access token, silent refresh + replay on 401, redirect to `/login` on refresh failure, session restore on reload.
- All commits follow Conventional Commits with the `dashboard` scope.
- Later milestones (design spec §13) start from this shell: tenancy UI (2), charts + report builder + analytics pages (3+).
