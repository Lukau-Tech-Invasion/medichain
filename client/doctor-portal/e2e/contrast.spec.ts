import { test, expect, Page } from '@playwright/test';

/**
 * Measured contrast audit of the rendered application, in both themes.
 *
 * Why this is an end-to-end test and not a unit test
 * --------------------------------------------------
 * Contrast is a property of *painted pixels*, not of source code. A component
 * can name a perfectly good token and still fail, because the colour it ends up
 * with depends on which ancestor supplied the background, which theme is
 * active, and which variant won the cascade. None of that exists until the page
 * is rendered in a browser.
 *
 * Every readability defect found on this project was found by looking at the
 * running application. `scripts/placeholder-audit.py` reported BEHAVIOURAL 0
 * while the analytics dashboard rendered twelve fabricated KPIs; the same
 * dashboard later shipped a 2.43:1 label that no unit test noticed. A gate that
 * reads source cannot catch either.
 *
 * This walks every rendered text node, resolves the colour it is actually
 * painted in and the background it is actually painted on, and applies the
 * WCAG 2.2 AA thresholds (1.4.3): 4.5:1 for normal text, 3:1 for large text
 * (>=24px, or >=18.66px when bold).
 */

/**
 * Routes worth guarding.
 *
 * No `/doctor` prefix: that prefix exists only when nginx serves both portals
 * from one origin (`VITE_BASE_PATH=/doctor`). Playwright drives the standalone
 * dev server, which mounts at `/`. Using the nginx paths here silently
 * redirected every route to `/dashboard` — five "passing" audits of the same
 * screen. The URL assertion below is what caught it, and is why it stays.
 */
const ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/analytics', name: 'Analytics' },
  { path: '/patients', name: 'Patient search' },
  { path: '/user-management', name: 'User management' },
  { path: '/settings', name: 'Settings' },
];

interface Failure {
  ratio: number;
  required: number;
  foreground: string;
  background: string;
  fontSize: number;
  text: string;
  selector: string;
}

/**
 * Runs inside the page. Kept as one self-contained function because it is
 * serialised across the CDP boundary and cannot close over anything here.
 */
async function auditContrast(page: Page): Promise<{ sampled: number; gradientSkipped: number; failures: Failure[] }> {
  return page.evaluate(() => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (colour: string): number | null => {
      const parts = colour.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      // A fully transparent colour paints nothing; treat it as unmeasurable
      // rather than as black, which would invent a passing or failing ratio.
      if (parts.length >= 4 && Number(parts[3]) === 0) return null;
      const [r, g, b] = parts.slice(0, 3).map(Number);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (fg: string, bg: string): number | null => {
      const a = luminance(fg);
      const b = luminance(bg);
      if (a === null || b === null) return null;
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      return (hi + 0.05) / (lo + 0.05);
    };

    /**
     * The background a element is actually painted on: walk up until something
     * paints. A gradient is reported separately rather than guessed at — an
     * element over `linear-gradient(...)` has no single background colour, and
     * pretending otherwise produced a spurious 1.0:1 "white on white" reading
     * for every heading on the gradient banner.
     */
    const backgroundOf = (el: Element): { colour?: string; gradient?: true } => {
      let node: Element | null = el;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return { gradient: true };
        const c = cs.backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return { colour: c };
        node = node.parentElement;
      }
      return { colour: 'rgb(255, 255, 255)' };
    };

    const describe = (el: Element) => {
      const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };

    const failures: Failure[] = [];
    let sampled = 0;
    let gradientSkipped = 0;

    document.querySelectorAll('p,span,td,th,li,h1,h2,h3,h4,h5,label,button,a,strong,em,small').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      // Only elements that own a direct text node — otherwise a wrapper is
      // measured using its child's colour and every failure is double-counted.
      const ownsText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()
      );
      if (!ownsText) return;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const bg = backgroundOf(el);
      if (bg.gradient) {
        gradientSkipped++;
        return;
      }
      const ratio = contrast(cs.color, bg.colour!);
      if (ratio === null) return;

      sampled++;
      const fontSize = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const required = fontSize >= 24 || (fontSize >= 18.66 && bold) ? 3 : 4.5;

      if (ratio < required) {
        failures.push({
          ratio: Number(ratio.toFixed(2)),
          required,
          foreground: cs.color,
          background: bg.colour!,
          fontSize,
          text: text.slice(0, 40),
          selector: describe(el),
        });
      }
    });

    failures.sort((a, b) => a.ratio - b.ratio);
    return { sampled, gradientSkipped, failures };
  });
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // The class flips CSS custom properties; give the style recalculation a frame
  // before sampling. Reading too early reports the previous theme's values and
  // manufactures failures that do not exist.
  await page.waitForTimeout(400);
}

function report(route: string, theme: string, result: { sampled: number; failures: Failure[] }) {
  const lines = result.failures.map(
    (f) =>
      `    ${f.ratio}:1 (needs ${f.required}:1)  ${f.selector}\n` +
      `      "${f.text}"\n` +
      `      ${f.foreground} on ${f.background} @ ${f.fontSize}px`
  );
  return (
    `${route} [${theme}]: ${result.failures.length} of ${result.sampled} sampled ` +
    `element(s) below WCAG AA\n${lines.join('\n')}`
  );
}

/**
 * Every route below is behind auth. Without signing in first, all ten tests
 * would happily measure the login page and report full coverage of screens they
 * never opened — the same shape of false assurance this suite exists to catch.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.locator('button:has-text("Mbeki")').click();
  await expect(page).toHaveURL(/.*dashboard/);
});

for (const route of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${route.name} meets WCAG AA in ${theme} mode`, async ({ page }) => {
      await page.goto(route.path);
      // NOT `waitForLoadState('networkidle')`. This app holds an SSE stream
      // open on /api/events for real-time push, so the network is never idle
      // and that wait can only ever time out — it failed all ten tests at 30s
      // before anything was measured.
      //
      // Wait for rendered content instead, which is what the audit actually
      // needs: measuring a loading skeleton proves nothing.
      // `main`, not `h1`: the first `h1` in the DOM belongs to the mobile
      // header, which is `lg:hidden` at desktop width. Waiting on it waits
      // forever for something deliberately invisible.
      await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
      // Let late-arriving data paint before sampling; a table that fills in
      // after the audit runs is a table the audit never checked.
      await page.waitForTimeout(1200);
      // Guard against a silent redirect back to /login leaving the audit
      // measuring the wrong screen.
      expect(page.url(), `${route.name} redirected away from ${route.path}`).toContain(route.path);
      await setTheme(page, theme);

      const result = await auditContrast(page);

      expect(result.sampled, `${route.name} rendered no measurable text`).toBeGreaterThan(0);
      expect(result.failures, report(route.name, theme, result)).toHaveLength(0);
    });
  }
}
