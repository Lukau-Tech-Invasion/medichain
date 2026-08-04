/**
 * Vitest Test Setup
 * 
 * This file runs before each test file to set up the testing environment.
 * It includes:
 * - DOM testing utilities
 * - Mock implementations
 * - Global test helpers
 */

import '@testing-library/jest-dom';
import React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Router hooks that work without a `<Router>` wrapper.
 *
 * ~47 of these test files render a page directly, with no `<MemoryRouter>`.
 * React Router's hooks throw outside a Router, and a hook throw unmounts the
 * whole tree — so those files rendered nothing and every assertion failed for a
 * reason that had nothing to do with the component under test.
 *
 * Only the *hooks* are stubbed. `MemoryRouter` and the components stay real, so
 * the ~30 files that do wrap keep working and nothing nests (React Router
 * rejects a Router inside a Router — an earlier attempt to wrap every render
 * globally hit exactly that). A test that needs to assert on navigation should
 * mock `useNavigate` itself; a file-level `vi.mock` overrides this one.
 *
 * `Link`/`NavLink` are rendered as plain anchors for the same reason: they read
 * Router context internally (`Cannot destructure property 'basename'`), and one
 * `<Link>` deep in a page was enough to blank the entire render — which is why
 * so many "unable to find text" failures were really "nothing rendered at all".
 */
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const anchor = ({ to, children, ...rest }: { to?: unknown; children?: React.ReactNode }) =>
    React.createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children);

  // Try the real hook first, fall back only when it throws for want of a Router.
  // A blanket stub is NOT safe here: the ~30 files that *do* set up
  // `<MemoryRouter><Routes><Route path="/patients/:patientId">` rely on real
  // `useParams`, and returning `{}` left components with no id, so they bailed
  // before fetching and sat on a spinner forever — turning correct tests red.
  const withFallback = <T,>(real: () => T, fallback: T) => (): T => {
    try {
      return real();
    } catch {
      return fallback;
    }
  };
  const realNavigate = actual.useNavigate as () => unknown;
  const realLocation = actual.useLocation as () => unknown;
  const realParams = actual.useParams as () => unknown;
  const realSearch = actual.useSearchParams as () => unknown;

  return {
    ...actual,
    useNavigate: withFallback(realNavigate, vi.fn()),
    useLocation: withFallback(realLocation, {
      pathname: '/', search: '', hash: '', state: null, key: 'test',
    }),
    useParams: withFallback(realParams, {}),
    useSearchParams: withFallback(realSearch, [new URLSearchParams(), vi.fn()]),
    Link: anchor,
    NavLink: anchor,
  };
});

/**
 * A default `fetch` for tests that don't supply one.
 *
 * Components fetch relative paths (`/api/...`). Node's fetch has no base URL, so
 * an unmocked call threw `Failed to parse URL from /api/...` inside an effect —
 * the component then rendered its error/empty branch, and assertions about real
 * content failed for reasons unrelated to the component. This returns an empty
 * but *well-shaped* success so a page renders its normal empty state.
 *
 * Only installed when the test file has not supplied its own fetch. Many files
 * assign `global.fetch = mockFetch` at *module* scope and then configure that
 * same reference in their `beforeEach`; since this hook runs first, overwriting
 * unconditionally would point the component at this stub instead of their mock
 * and silently starve their assertions of data.
 */
beforeEach(() => {
  if (vi.isMockFunction(global.fetch)) return;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ success: true, data: [], records: [], patients: [], items: [] }),
    text: async () => '{"success":true}',
    blob: async () => new Blob([]),
  }) as unknown as typeof fetch;
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia (used by responsive components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver (used by some UI components)
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock console methods in tests to reduce noise
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  // Suppress React act() warnings in tests
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Warning: An update to') ||
      args[0].includes('Warning: ReactDOM.render'))
  ) {
    return;
  }
  originalConsoleError(...args);
};

// Global test utilities
export const mockFetch = (data: unknown, options?: { ok?: boolean; status?: number }) => {
  return vi.fn().mockResolvedValue({
    ok: options?.ok ?? true,
    status: options?.status ?? 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
};

// Type declarations for global test utilities
declare global {
  function mockFetch(data: unknown, options?: { ok?: boolean; status?: number }): ReturnType<typeof vi.fn>;
}
