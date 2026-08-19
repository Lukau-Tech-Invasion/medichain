/**
 * Shared test fetch stub for the client workspaces.
 *
 * ## Why this exists (Horizon H3 / issue #9, Class B)
 *
 * The doctor-portal test setup used to install a default `fetch` resolving:
 *
 * ```js
 * { success: true, data: [], records: [], patients: [], items: [] }
 * ```
 *
 * That envelope is only one of the shapes this codebase's endpoints return.
 * Plenty of pages do `const data = await res.json(); data.map(...)` on the
 * parsed body directly — and against the envelope that threw
 * `TypeError: data.map is not a function`, pushing the component into its
 * **error branch**.
 *
 * The consequence was worse than "the mock didn't help": pages rendered error
 * states they would never reach in production, and error states typically hide
 * the rest of the UI (tab strips, forms, tables). Tests then failed looking for
 * elements the component was *correct* not to render — so the default stub was
 * actively manufacturing failures. Measured baseline: 206 of 332 tests failing
 * across 106 files, with this as a major contributor.
 *
 * ## The fix
 *
 * Return a body that satisfies **both** consumption patterns at once: a real
 * `Array` carrying the envelope keys as own properties.
 *
 *   - `body.map(...)`      works — it is genuinely an array
 *   - `Array.isArray(body)` is `true`
 *   - `body.length`        is `0`
 *   - `body.data`          is `[]`
 *   - `body.success`       is `true`
 *
 * So an array-consumer sees an empty list and an envelope-consumer sees an
 * empty envelope. Both render their normal **empty** state, which is what a
 * test with no fixtures should see — rather than an error state.
 *
 * This is a floor, not a substitute for fixtures. A test asserting on real
 * content must still supply its own `fetch`; see `jsonResponse` below.
 */

/** The envelope keys pages look for, kept in one place. */
const ENVELOPE_KEYS = {
  success: true,
  data: [] as unknown[],
  records: [] as unknown[],
  patients: [] as unknown[],
  items: [] as unknown[],
  results: [] as unknown[],
  total: 0,
};

/**
 * An empty body that is simultaneously an array and an envelope.
 *
 * A fresh object each call: tests mutate what they receive, and a shared
 * instance would leak state between them.
 */
export function emptyDualShapeBody(): unknown[] & typeof ENVELOPE_KEYS {
  return Object.assign([] as unknown[], {
    ...ENVELOPE_KEYS,
    data: [] as unknown[],
    records: [] as unknown[],
    patients: [] as unknown[],
    items: [] as unknown[],
    results: [] as unknown[],
  }) as unknown[] & typeof ENVELOPE_KEYS;
}

/** Build a `Response`-like object around an arbitrary JSON body. */
export function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
  };
}

/**
 * Install the default stub on `globalThis.fetch`, unless the test file has
 * already supplied its own.
 *
 * The guard matters: many files assign `global.fetch = mockFetch` at *module*
 * scope and configure that same reference inside their own `beforeEach`. Since
 * a setup-file hook runs first, overwriting unconditionally would repoint the
 * component at this stub and silently starve those tests of their data.
 *
 * @param vi - the Vitest `vi` helper, passed in so this module stays free of a
 *             direct vitest import and can be used from any workspace.
 */
export function installDefaultFetch(vi: {
  isMockFunction: (f: unknown) => boolean;
  fn: () => { mockResolvedValue: (v: unknown) => unknown };
}): void {
  const g = globalThis as { fetch?: unknown };
  if (vi.isMockFunction(g.fetch)) return;
  g.fetch = vi.fn().mockResolvedValue(jsonResponse(emptyDualShapeBody()));
}
