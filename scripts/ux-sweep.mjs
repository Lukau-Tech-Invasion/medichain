// UX sweep: visit every navigation route for every role and measure what a user meets —
// screens of scrolling (desktop and phone), sideways scroll at 390 px, unnamed controls,
// targets under 24 px, raw patient ids on screen, console errors.
//
// Read-only. Fixture accounts on local dev servers only (doctor portal :5173, patient app
// :5174); paced for the API's 60 requests/minute limit. Routes come from the navigation
// config, so a new page is swept without editing this file.
//
//   node scripts/ux-sweep.mjs [Role ...]      # writes docs/ux-audit/sweep-<date>.json
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(ROOT, 'client', 'package.json'))('playwright');

/** Every `to:` path in each role's navigation block, and the patient app's nav sections. */
function loadRoutes() {
  const nav = readFileSync(join(ROOT, 'client/doctor-portal/src/config/navigation.ts'), 'utf8');
  const blocks = { Admin: 'ADMIN_NAV', Doctor: 'DOCTOR_NAV', Nurse: 'NURSE_NAV', LabTechnician: 'LAB_TECH_NAV', Pharmacist: 'PHARMACIST_NAV', Paramedic: 'PARAMEDIC_NAV' };
  const out = {};
  for (const [role, name] of Object.entries(blocks)) {
    const start = nav.indexOf(`export const ${name}`);
    const end = nav.indexOf('\nexport const', start + 1);
    const block = nav.slice(start, end < 0 ? undefined : end);
    out[role] = [...new Set([...block.matchAll(/to: '(\/[^']*)'/g)].map((m) => m[1]))].sort();
  }
  const layout = readFileSync(join(ROOT, 'client/shared/src/components/Layout.tsx'), 'utf8');
  const sections = layout.split('patientNavSections')[1]?.split('patientMainNav')[0] ?? '';
  out.Patient = [...new Set([...sections.matchAll(/path: '(\/[^']*)'/g)].map((m) => m[1]))].sort();
  return out;
}
const routes = loadRoutes();
const PASSWORD = process.env.MEDICHAIN_FIXTURE_PASSWORD ?? 'BrowserTest!2026';
const ACCOUNTS = {
  Doctor: 'bt.doctor.final', Nurse: 'bt.nurse.final', LabTechnician: 'bt.lab.final',
  Pharmacist: 'bt.pharm.final', Paramedic: 'bt.paramedic.final', Admin: 'bt.admin.final', Patient: 'btpatient.final',
};

// The staff portal scrolls inside a panel, not the document: measure the element that scrolls most.
const scrollerJs = `(() => {
  const all = [document.scrollingElement, ...document.querySelectorAll('main, main *, body > div, body > div > div, body > div > div > div')];
  let best = document.scrollingElement;
  for (const e of all) {
    if (!e) continue;
    const st = getComputedStyle(e);
    const scrollable = e === document.scrollingElement || /(auto|scroll)/.test(st.overflowY);
    if (scrollable && e.clientHeight > innerHeight * 0.5 && e.scrollHeight / e.clientHeight > best.scrollHeight / best.clientHeight) best = e;
  }
  return best;
})()`;
const only = process.argv.slice(2);
const results = [];

const measure = (scrollerJs) => {
  const scroller = eval(scrollerJs);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const main = document.querySelector('main') ?? document.body;
  const named = (e) => {
    if (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title')) return true;
    if (e.labels && e.labels.length && [...e.labels].some((l) => l.textContent.trim())) return true;
    return ['BUTTON', 'A'].includes(e.tagName) && e.textContent.trim().length > 0;
  };
  const controls = [...main.querySelectorAll('input:not([type=hidden]), select, textarea, button, a[href]')].filter(vis);
  const fields = controls.filter((e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName));
  return {
    screens: +(scroller.scrollHeight / scroller.clientHeight).toFixed(1),
    h1: document.querySelectorAll('h1').length,
    controls: controls.length,
    fields: fields.length,
    unlabeled: controls.filter((e) => !named(e)).map((e) => e.tagName + (e.type ? ':' + e.type : '') + ':' + (e.placeholder || e.name || e.id || '').slice(0, 24)).slice(0, 6),
    unlabeledCount: controls.filter((e) => !named(e)).length,
    tiny: controls.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length,
    errorText: (main.innerText.match(/(failed to load|could not load|something went wrong|error loading|unable to load)[^\n]{0,60}/i) || [''])[0],
    rawIds: (main.innerText.match(/PAT-[0-9a-f]{32}/g) || []).length,
  };
};

async function signIn(page, role) {
  const base = role === 'Patient' ? 'http://localhost:5174' : 'http://localhost:5173';
  await page.goto(base + '/login');
  if (role === 'Patient') await page.getByLabel('Username').fill(ACCOUNTS[role]);
  else await page.getByPlaceholder('e.g. dr.mbeki').fill(ACCOUNTS[role]);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  return base;
}

const browser = await chromium.launch();
for (const role of Object.keys(ACCOUNTS)) {
  if (only.length && !only.includes(role)) continue;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)); });
  let base;
  try { base = await signIn(page, role); } catch (e) { results.push({ role, route: 'LOGIN', error: String(e).slice(0, 200) }); await ctx.close(); continue; }
  for (const route of routes[role]) {
    consoleErrors.length = 0;
    const t0 = Date.now();
    try {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const desk = await page.evaluate(measure, scrollerJs);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      const phone = await page.evaluate((js) => {
        const sc = eval(js);
        const wide = [document.documentElement, sc].map((e) => e.scrollWidth - e.clientWidth);
        return { screens: +(sc.scrollHeight / sc.clientHeight).toFixed(1), overflowX: Math.max(...wide) };
      }, scrollerJs);
      await page.setViewportSize({ width: 1280, height: 800 });
      results.push({ role, route, landed: new URL(page.url()).pathname, ms: Date.now() - t0, desk, phone, consoleErrors: [...new Set(consoleErrors)].slice(0, 3) });
    } catch (e) {
      results.push({ role, route, error: String(e).slice(0, 200) });
    }
    console.log(role, route);
    writeFileSync(join(ROOT, 'docs/ux-audit', 'sweep-partial.json'), JSON.stringify(results, null, 1));
    await page.waitForTimeout(3000); // pacing: stay under the API rate limit
  }
  await ctx.close();
}
await browser.close();
mkdirSync(join(ROOT, 'docs/ux-audit'), { recursive: true });
const file = join(ROOT, 'docs/ux-audit', `sweep-${new Date().toISOString().slice(0, 10)}${only.length ? '-' + only.join('-') : ''}.json`);
writeFileSync(file, JSON.stringify(results, null, 1));
console.log('wrote', file, results.length);
