import { test, expect, Page } from '@playwright/test';

/**
 * WCAG 2.2 Level AA criteria other than text contrast.
 *
 * `contrast.spec.ts` measures SC 1.4.3 across 12 routes and passes. That is one
 * criterion. This file covers the ones that were claimed rather than measured:
 *
 *   3.1.1  Language of Page          A
 *   1.4.10 Reflow                    AA   320 CSS px, no two-dimensional scroll
 *   1.4.11 Non-text Contrast         AA   3:1 for control boundaries
 *   2.1.1  Keyboard                  A
 *   2.4.7  Focus Visible             AA
 *   2.4.11 Focus Not Obscured (Min)  AA   sticky headers
 *   2.5.8  Target Size (Minimum)     AA   24 x 24 CSS px
 *
 * Two of these deserve their reputation:
 *
 * **1.4.11 is the one people miss.** Contrast is understood to apply to text.
 * It also applies to the parts of a control that identify it — an input border,
 * a focus ring, a meaningful icon — at 3:1 against adjacent colour. A 1px pale
 * grey border on white is about 1.2:1 and fails.
 *
 * **2.1.1 is the cheapest test that exists.** Unplug the mouse. If Tab cannot
 * reach and operate every control, the page fails Level A. It catches
 * div-as-button, custom dropdowns, and modals that do not trap focus.
 *
 * On 1.4.10: 320 CSS px is not "small phones". The W3C Understanding document
 * puts it exactly — 320px is **a 1280px desktop viewport at 400% zoom**, which
 * is how many low-vision users browse. A layout that breaks there fails a real
 * desktop user.
 */

const ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/triage', name: 'Triage' },
  { path: '/patients', name: 'Patient search' },
  { path: '/settings', name: 'Settings' },
];

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.locator('button:has-text("Mbeki")').click();
  await expect(page).toHaveURL(/.*dashboard/);
});

async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// 3.1.1 Language of Page (A)
// ---------------------------------------------------------------------------
test('the page declares its language', async ({ page }) => {
  await settle(page, '/dashboard');
  const lang = await page.getAttribute('html', 'lang');
  expect(lang, 'a screen reader picks its pronunciation rules from <html lang>').toBeTruthy();
  expect(lang!.trim().length).toBeGreaterThan(1);
});

// ---------------------------------------------------------------------------
// 1.4.10 Reflow (AA) — 320 CSS px with no horizontal scrolling
// ---------------------------------------------------------------------------
for (const route of ROUTES) {
  test(`${route.name} reflows at 320px without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await settle(page, route.path);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      // A few pixels of slack: sub-pixel rounding and scrollbar gutters are not
      // the two-dimensional scrolling the criterion is about.
      const slack = 4;
      const overflowing: string[] = [];
      if (doc.scrollWidth > doc.clientWidth + slack) {
        // Name the widest offenders so a failure is actionable rather than a
        // number to go hunting for.
        document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > doc.clientWidth + slack) {
            const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.');
            overflowing.push(
              `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} extends to ${Math.round(r.right)}px`
            );
          }
        });
      }
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        offenders: Array.from(new Set(overflowing)).slice(0, 6),
      };
    });

    expect(
      overflow.scrollWidth,
      `${route.name} needs horizontal scrolling at 320px ` +
        `(content ${overflow.scrollWidth}px in a ${overflow.clientWidth}px viewport).\n` +
        `This is a desktop user at 400% zoom, not only a small phone.\n` +
        overflow.offenders.map((o) => `  - ${o}`).join('\n')
    ).toBeLessThanOrEqual(overflow.clientWidth + 4);
  });
}

// ---------------------------------------------------------------------------
// 2.5.8 Target Size (Minimum) (AA) — 24 x 24 CSS px
// ---------------------------------------------------------------------------
test('interactive targets are at least 24x24 CSS pixels', async ({ page }) => {
  await settle(page, '/dashboard');

  const undersized = await page.evaluate(() => {
    const MIN = 24;
    const results: { selector: string; w: number; h: number; text: string }[] = [];
    document.querySelectorAll<HTMLElement>('button, a[href], input, select, [role="button"]').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // A visually-hidden control is clipped to about 1px until it is focused.
      // The skip link is the canonical case: measured while hidden it reports
      // 16x8 and looks like a violation, when in reality it is not a target at
      // all until a keyboard user reaches it. Its focused size is checked
      // separately below.
      const clipped =
        cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
        cs.clipPath === 'inset(50%)' ||
        (r.width <= 2 && r.height <= 2);
      if (clipped || el.className.includes('sr-only')) return;
      // SC 2.5.8 exempts targets in a sentence ("inline"), and those whose
      // spacing gives them a 24px exclusion zone. Approximate the inline
      // exception by skipping anchors laid out inline inside text.
      if (el.tagName === 'A' && cs.display === 'inline') return;
      if (r.width < MIN || r.height < MIN) {
        const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
        results.push({
          selector: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
        });
      }
    });
    return results;
  });

  expect(
    undersized,
    `Targets below 24x24 CSS px (WCAG 2.2 SC 2.5.8, Level AA):\n` +
      undersized.map((u) => `  ${u.selector} ${u.w}x${u.h} "${u.text}"`).join('\n')
  ).toHaveLength(0);
});

/**
 * The skip link, measured in the only state where it is a target.
 *
 * It is `sr-only` until focused, so the sweep above cannot judge it. But it is
 * the first thing a keyboard user meets, and it is the mechanism that lets them
 * bypass the whole navigation — if it is unreachable or too small to activate,
 * every subsequent page costs them 30 tab presses.
 */
test('the skip link is reachable and large enough once focused', async ({ page }) => {
  await settle(page, '/dashboard');
  // No click first. Clicking to "reset" focus actually SETS it: a click at
  // (5,5) lands inside the sidebar, so Tab resumes from there and the skip
  // link -- which precedes the sidebar -- is already behind the cursor. After a
  // navigation focus sits on the document, which is where a keyboard user
  // genuinely starts.

  // Within the first few stops, not strictly first: a browser may place focus
  // on the document or an skip-adjacent control before it. What matters is that
  // a keyboard user meets it before the navigation, not its exact index.
  const stops: { text: string; href: string | null; w: number; h: number }[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      // An icon-only control has no textContent; its name lives in
      // aria-label/title. Reporting only textContent made every icon button
      // look nameless, which buried the real finding under a false one.
      return {
        text: (
          el.textContent?.trim() ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          ''
        ).slice(0, 40),
        href: el.getAttribute('href'),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    if (stop) stops.push(stop);
  }

  const skip = stops.find((s) => /skip/i.test(s.text));
  expect(
    skip,
    `No skip link in the first three tab stops. Saw:\n` +
      stops.map((s, i) => `  ${i + 1}. "${s.text}" (${s.w}x${s.h})`).join('\n')
  ).toBeDefined();
  expect(skip!.href, 'the skip link must point at the main landmark').toBeTruthy();
  expect(
    Math.min(skip!.w, skip!.h),
    `focused skip link is ${skip!.w}x${skip!.h}; SC 2.5.8 wants 24x24 minimum`
  ).toBeGreaterThanOrEqual(24);
});

// ---------------------------------------------------------------------------
// 2.1.1 Keyboard (A) + 2.4.7 Focus Visible (AA)
// ---------------------------------------------------------------------------
test('tabbing reaches controls and every focused control is visibly indicated', async ({ page }) => {
  await settle(page, '/dashboard');
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  const invisible: string[] = [];
  let reached = 0;

  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
      // A visible indicator is an outline, a ring (box-shadow), or a border
      // change. `outline: none` with nothing replacing it is the classic 2.4.7
      // failure.
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const hasRing = cs.boxShadow !== 'none' && cs.boxShadow.trim() !== '';
      return {
        selector: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
        indicated: hasOutline || hasRing,
      };
    });
    if (!state) continue;
    reached++;
    if (!state.indicated) invisible.push(`${state.selector} "${state.text}"`);
  }

  expect(reached, 'Tab reached no focusable control at all').toBeGreaterThan(5);
  expect(
    Array.from(new Set(invisible)),
    `Focused with no visible indicator (WCAG 2.2 SC 2.4.7, Level AA).\n` +
      `A keyboard user cannot tell where they are:\n` +
      Array.from(new Set(invisible)).map((s) => `  ${s}`).join('\n')
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 2.4.11 Focus Not Obscured (Minimum) (AA)
// ---------------------------------------------------------------------------
test('a focused control is never hidden behind the sticky header', async ({ page }) => {
  await settle(page, '/patients');
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  const obscured: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const hidden = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      // Is the CENTRE of the focused control covered by a different, fixed or
      // sticky element? That is the shape of the sticky-header failure: Tab
      // scrolls the control under the bar and the user sees nothing move.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cy < 0 || cy > window.innerHeight) return null;
      const top = document.elementFromPoint(cx, cy);
      if (!top || el.contains(top) || top.contains(el)) return null;
      let node: Element | null = top;
      while (node) {
        const pos = getComputedStyle(node).position;
        if (pos === 'fixed' || pos === 'sticky') {
          const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
          return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} covered by ${node.tagName.toLowerCase()} (${pos})`;
        }
        node = node.parentElement;
      }
      return null;
    });
    if (hidden) obscured.push(hidden);
  }

  expect(
    Array.from(new Set(obscured)),
    `Focused controls hidden behind sticky/fixed content (SC 2.4.11).\n` +
      `Usual fix: scroll-margin-top on focusable elements, matching the bar height.\n` +
      Array.from(new Set(obscured)).map((s) => `  ${s}`).join('\n')
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 1.4.11 Non-text Contrast (AA) — 3:1 for the boundary that identifies a control
// ---------------------------------------------------------------------------
test('form control boundaries meet 3:1 against their surroundings', async ({ page }) => {
  await settle(page, '/settings');

  const weak = await page.evaluate(() => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (colour: string): number | null => {
      const p = colour.match(/[\d.]+/g);
      if (!p || p.length < 3) return null;
      if (p.length >= 4 && Number(p[3]) === 0) return null;
      const [r, g, b] = p.slice(0, 3).map(Number);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: string, b: string) => {
      const x = lum(a);
      const y = lum(b);
      if (x === null || y === null) return null;
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const surfaceBehind = (el: Element): string => {
      let n: Element | null = el.parentElement;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        n = n.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };

    const findings: { selector: string; ratio: number; border: string; behind: string }[] = [];
    document.querySelectorAll<HTMLElement>('input, select, textarea').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // A control identified by its fill rather than a stroke is out of scope
      // for this check: with no border there is no boundary to measure.
      if (cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) return;
      const behind = surfaceBehind(el);
      const value = ratio(cs.borderTopColor, behind);
      if (value !== null && value < 3) {
        const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
        findings.push({
          selector: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
          ratio: Number(value.toFixed(2)),
          border: cs.borderTopColor,
          behind,
        });
      }
    });
    return findings;
  });

  expect(
    weak,
    `Control borders below 3:1 (WCAG 2.2 SC 1.4.11, Level AA).\n` +
      `The border is what tells a user where to type:\n` +
      weak.map((w) => `  ${w.selector} ${w.ratio}:1 — ${w.border} on ${w.behind}`).join('\n')
  ).toHaveLength(0);
});
