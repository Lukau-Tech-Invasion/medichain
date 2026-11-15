/**
 * Imported first by a script that reuses `seed-browser-test-fixtures.ts`'s
 * helpers, so that importing them does not also run its `main()`.
 *
 * An argv check cannot tell the two apart: vite-node, the documented way to
 * run the seeder, removes the script's own path from `process.argv`. ES
 * modules evaluate their imports in order, so this marker is set before the
 * seeder module is evaluated.
 */
(globalThis as { __medichainSeedAsLibrary?: boolean }).__medichainSeedAsLibrary = true;
export {};
