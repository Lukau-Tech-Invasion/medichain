/**
 * Fields the API sends but never fills: the "Last login: Never" defect class.
 *
 * `users.last_login_at` existed, the user list returned it, the screen showed
 * it, and nothing wrote it, so every account read "Never". Reading code finds
 * this only by luck. This asks a running server instead: it signs in as an
 * administrator, a doctor and a patient, calls every parameter-free GET route
 * (read from `#[get(...)]` in api/src), and reports each list field that is
 * present in three or more rows and empty (null, "", []) in every one of them.
 * A zero or `false` is not reported: those can be true answers.
 *
 * Run it against a stack that has data (the QA stack after the browser and
 * journey suites), never against production:
 *
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8889/api MEDICHAIN_FIXTURE_MANIFEST=<manifest> \
 *     ./node_modules/.bin/vite-node ../scripts/probe-empty-fields.ts
 *
 * A finding is a lead, not a verdict: a field can be empty because no screen
 * has written it YET on this database. Check each by performing the action
 * that should fill it and reading the record back.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { http, loadManifest, loginWithPassword, passwordFor, type Json, type Session } from './lib/journey';

const ROOT = join(__dirname, '..');
const PACE_MS = 350;
const MIN_ROWS = 3;

function getRoutes(): string[] {
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.rs')) {
        const text = readFileSync(path, 'utf8');
        const cut = text.indexOf('#[cfg(test)]');
        for (const match of (cut === -1 ? text : text.slice(0, cut)).matchAll(/#\[get\("(\/api\/[^"{}]+)"\)\]/g)) {
          routes.add(match[1]);
        }
      }
    }
  };
  walk(join(ROOT, 'api', 'src'));
  // Streams and probes answer something other than a JSON document.
  return [...routes].filter((route) => !/\/(events|health|ready|live|metrics)$/.test(route)).sort();
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/** Every array of objects in a body, by its path. */
function arraysOf(body: unknown, path = '', depth = 0, found: Array<[string, Json[]]> = []): Array<[string, Json[]]> {
  if (depth > 3 || body === null || typeof body !== 'object') return found;
  if (Array.isArray(body)) {
    const rows = body.filter((row): row is Json => row !== null && typeof row === 'object' && !Array.isArray(row));
    if (rows.length) found.push([path || '(root)', rows]);
    return found;
  }
  for (const [key, value] of Object.entries(body as Json)) arraysOf(value, path ? `${path}.${key}` : key, depth + 1, found);
  return found;
}

async function signInAs(role: string, loginId: string): Promise<Session | null> {
  try {
    return await loginWithPassword(loginId, passwordFor(loginId), role, role === 'Patient' ? 'Patient' : undefined);
  } catch (error) {
    console.log(`  (skipping ${role}: ${(error as Error).message.slice(0, 120)})`);
    return null;
  }
}

async function main() {
  const manifest = loadManifest();
  const staff = (role: string) => manifest.staff.find((member) => member.role === role);
  const accounts: Array<[string, string | undefined]> = [
    ['Admin', staff('Admin')?.login_id],
    ['Doctor', staff('Doctor')?.login_id],
    ['Patient', manifest.patient?.login_id],
  ];
  const routes = getRoutes();
  console.log(`\n${routes.length} parameter-free GET routes\n`);
  const findings = new Map<string, Set<string>>();

  for (const [role, loginId] of accounts) {
    if (!loginId) continue;
    const session = await signInAs(role, loginId);
    if (!session) continue;
    for (const route of routes) {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
      const response = await http('GET', route.replace(/^\/api/, ''), { token: session.token });
      if (response.status !== 200) continue;
      for (const [path, rows] of arraysOf(response.json)) {
        if (rows.length < MIN_ROWS) continue;
        const keys = new Set(rows.flatMap((row) => Object.keys(row)));
        for (const key of keys) {
          if (rows.every((row) => isEmpty(row[key]))) {
            const where = `${route} ${path}.${key}`;
            const seenBy = findings.get(where) ?? new Set<string>();
            seenBy.add(`${role}(${rows.length})`);
            findings.set(where, seenBy);
          }
        }
      }
    }
  }

  console.log(`${findings.size} fields empty in every row:\n`);
  for (const [where, seenBy] of [...findings].sort()) console.log(`  ${where}   [${[...seenBy].join(', ')}]`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
