import '@testing-library/jest-dom';
import React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
// Relative rather than '@medichain/shared': the package resolves through
// `main: src/index.ts`, which has no subpath export for test-only helpers, and
// test utilities should not be reachable from the production bundle.
import { installDefaultFetch } from '../../../shared/src/testing/fetchMock';

/**
 * Router hooks that work without a `<Router>` wrapper.
 *
 * 10 of this workspace's test files render a page directly, with no
 * `<MemoryRouter>`. React Router's hooks throw outside a Router, and a hook
 * throw unmounts the whole tree — so those files rendered nothing and every
 * assertion failed for a reason unrelated to the component under test
 * (`useNavigate() may be used only in the context of a <Router> component`).
 *
 * This is the same fallback doctor-portal already carries; patient-app never
 * got it. Only the *hooks* are stubbed, and each tries the real hook first, so
 * the files that DO wrap in `<MemoryRouter>` keep their real `useParams` and
 * nothing nests (React Router rejects a Router inside a Router).
 *
 * `Link`/`NavLink` render as plain anchors for the same reason: they read
 * Router context internally, and one `<Link>` deep in a page is enough to
 * blank the entire render.
 */
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const anchor = ({ to, children, ...rest }: { to?: unknown; children?: React.ReactNode }) =>
    React.createElement('a', { href: typeof to === 'string' ? to : '#', ...rest }, children);

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
 * Horizon H3 / Class B. Unlike doctor-portal, this workspace had NO default at
 * all, so components fetching relative `/api/...` paths hit Node's real fetch,
 * which has no base URL and throws `Failed to parse URL` inside the mount
 * effect — the component then rendered its error branch and every content
 * assertion failed for reasons unrelated to the component under test.
 *
 * Never overwrites a fetch the test file supplied itself.
 */
beforeEach(() => {
  installDefaultFetch(vi);
});

/**
 * NO `indexedDB` shim here — deliberately, and this comment exists so nobody
 * adds one back without reading why.
 *
 * jsdom omits IndexedDB, and 3 patient-app tests fail with
 * `ReferenceError: indexedDB is not defined`. A presence-only stub (an `open()`
 * returning a request whose `onsuccess` is never fired) was tried and **made
 * things worse**: it flipped feature detection. Code that had been skipping the
 * offline path because IndexedDB was absent started taking it, then waited
 * forever on a callback the stub never invokes. Measured: EmergencyCardPage went
 * from 3/3 passing to 3/3 failing, while fixing none of the 3 it targeted — a
 * net loss.
 *
 * If those 3 tests are worth fixing, install a real implementation
 * (`fake-indexeddb`) so the offline path actually completes. A stub that is
 * present but non-functional is worse than an absent API.
 */

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
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
