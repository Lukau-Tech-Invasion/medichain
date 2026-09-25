/**
 * Measured contrast of a rendered page, for both applications' browser suites.
 *
 * # Why this replaced two copies of a narrower auditor
 *
 * Each app carried its own auditor, and both measured the same subset: text
 * owned directly by `p, span, td, th, li, h1-h5, label, button, a, strong, em,
 * small`. White-on-white text kept reaching users past a green suite because of
 * what that subset could not see:
 *
 *   * **A `<div>`, `<dd>` or `<dt>` with its own text** -- the commonest way a
 *     value is rendered here -- was never measured.
 *   * **A form control's value is not a text node.** The insurance policy
 *     number typed into a white box in a dark page was invisible to every
 *     probe (see `scripts/check-form-control-contrast.py`).
 *   * **A semi-transparent background was treated as opaque.** `bg-black/50`
 *     read as pure black; `bg-primary-900/30` as a solid navy.
 *   * **Anything over a gradient was skipped outright**, so a whole banner of
 *     text went unmeasured.
 *   * **Colour transitions were sampled mid-flight.** A 150ms
 *     `transition-colors` read 400ms after a theme flip is usually settled and
 *     sometimes not; the audit now switches transitions off for the page.
 *
 * Contrast is a property of painted pixels, so this walks the rendered page:
 * the colour each piece of text is painted in, composited over every
 * translucent layer beneath it down to the first opaque one, against WCAG 2.2
 * SC 1.4.3 -- 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold).
 * Over a gradient the WORST stop is used: text has to be readable across the
 * whole of it, not on average.
 *
 * Known limit: the background is the element's ancestors, not what happens to
 * be painted behind it. An absolutely positioned label over a sibling image is
 * measured against its ancestors' colour.
 */
import type { Page } from '@playwright/test';

export type ContrastKind = 'text' | 'control' | 'placeholder';

export interface ContrastFailure {
  kind: ContrastKind;
  ratio: number;
  required: number;
  foreground: string;
  background: string;
  fontSize: number;
  text: string;
  selector: string;
  /** The element's full class list, which is what finds it in the source. */
  classes: string;
  /** Up to three ancestors' class lists, nearest first. */
  context: string[];
  disabled: boolean;
}

export interface ContrastResult {
  sampled: number;
  /** Text over a `url(...)` background image, which has no colour to measure. */
  overImage: number;
  failures: ContrastFailure[];
}

/** Flip the theme the way the applications do: class plus `color-scheme`. */
export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.classList.toggle('dark', t === 'dark');
    root.style.colorScheme = t;
  }, theme);
  // Transitions are off (see `freezeMotion`), so two frames is a settled style.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

/**
 * Switch off transitions and animations for the rest of the page's life.
 *
 * Without this a theme flip is sampled while `transition-colors` is still
 * interpolating, and the reading is a colour neither theme ever paints.
 */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
}

export async function auditContrast(page: Page): Promise<ContrastResult> {
  return page.evaluate(() => {
    type RGB = [number, number, number];
    type RGBA = [number, number, number, number];

    const parse = (colour: string): RGBA | null => {
      const m = /rgba?\(([^)]+)\)/.exec(colour);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
      return [p[0], p[1], p[2], p.length >= 4 && !Number.isNaN(p[3]) ? p[3] : 1];
    };
    const over = (top: RGBA, bottom: RGB): RGB => [
      top[0] * top[3] + bottom[0] * (1 - top[3]),
      top[1] * top[3] + bottom[1] * (1 - top[3]),
      top[2] * top[3] + bottom[2] * (1 - top[3]),
    ];
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (c: RGB) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const ratioOf = (a: RGB, b: RGB) => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;

    type Layer = { colour: RGBA } | { stops: RGBA[] };

    /**
     * Every colour the element could be painted on: the translucent layers
     * above the first opaque one, composited in paint order. A gradient
     * contributes each of its stops, so the result is a set, and the caller
     * takes the worst.
     */
    const backgroundsOf = (el: Element): { colours: RGB[]; opacity: number } | 'image' => {
      const layers: Layer[] = [];
      let opacity = 1;
      let base: RGB | null = null;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        opacity *= parseFloat(cs.opacity) || 1;
        const image = cs.backgroundImage;
        if (image && image !== 'none') {
          if (/url\(/.test(image)) return 'image';
          const stops = (image.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean) as RGBA[];
          if (stops.length) layers.push({ stops });
        }
        const colour = parse(cs.backgroundColor);
        if (colour && colour[3] > 0) {
          if (colour[3] >= 1) {
            base = [colour[0], colour[1], colour[2]];
            break;
          }
          layers.push({ colour });
        }
      }
      // Nothing opaque anywhere: the canvas, which follows `color-scheme`.
      let colours: RGB[] = [
        base ?? (document.documentElement.classList.contains('dark') ? [18, 18, 18] : [255, 255, 255]),
      ];
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if ('colour' in layer) {
          colours = colours.map((c) => over(layer.colour, c));
        } else {
          colours = colours.flatMap((c) => layer.stops.map((s) => over(s, c)));
        }
        if (colours.length > 24) colours = colours.slice(0, 24);
      }
      return { colours, opacity };
    };

    const visible = (el: HTMLElement, cs: CSSStyleDeclaration) => {
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // Visually hidden (sr-only): clipped to ~1px and never painted.
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
      if (r.width <= 2 && r.height <= 2) return false;
      return !el.closest('.sr-only');
    };

    const classesOf = (el: Element | null) => (el?.getAttribute('class') || '').trim().slice(0, 160);
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = classesOf(el).split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}`;
    };
    const context = (el: Element) => {
      const out: string[] = [];
      for (let n = el.parentElement; n && out.length < 3; n = n.parentElement) {
        const c = classesOf(n);
        if (c) out.push(`${n.tagName.toLowerCase()}: ${c}`);
      }
      return out;
    };

    const failures: ContrastFailure[] = [];
    const seen = new Set<string>();
    let sampled = 0;
    let overImage = 0;

    const measure = (
      el: HTMLElement,
      kind: ContrastKind,
      fgColour: string,
      text: string,
      cs: CSSStyleDeclaration
    ) => {
      const fg = parse(fgColour);
      if (!fg || fg[3] === 0) return;
      const bgs = backgroundsOf(el);
      if (bgs === 'image') {
        overImage++;
        return;
      }
      sampled++;
      let worst = Infinity;
      let worstBg: RGB = bgs.colours[0];
      let worstFg: RGB = [fg[0], fg[1], fg[2]];
      for (const bg of bgs.colours) {
        // The text's own alpha, then any ancestor opacity, both blend it
        // toward what is underneath.
        let painted = over(fg, bg);
        if (bgs.opacity < 1) painted = over([...painted, bgs.opacity] as RGBA, bg);
        const r = ratioOf(painted, bg);
        if (r < worst) {
          worst = r;
          worstBg = bg;
          worstFg = painted;
        }
      }
      const fontSize = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const required = fontSize >= 24 || (fontSize >= 18.66 && bold) ? 3 : 4.5;
      if (worst >= required) return;
      const key = `${kind}|${classesOf(el)}|${css(worstFg)}|${css(worstBg)}|${text.slice(0, 24)}`;
      if (seen.has(key)) return;
      seen.add(key);
      failures.push({
        kind,
        ratio: Number(worst.toFixed(2)),
        required,
        foreground: css(worstFg),
        background: css(worstBg),
        fontSize,
        text: text.slice(0, 60),
        selector: describe(el),
        classes: classesOf(el),
        context: context(el),
        disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
      });
    };

    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'TITLE']);
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (SKIP.has(el.tagName) || el.closest('svg')) continue;
      const owns = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()
      );
      const isControl = el.matches('input, textarea, select');
      if (!owns && !isControl) continue;
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;

      if (isControl) {
        const input = el as HTMLInputElement;
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        if (['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
        const value =
          el.tagName === 'SELECT'
            ? (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() || ''
            : input.value;
        if (value) {
          measure(el, 'control', cs.color, value, cs);
        } else if (input.placeholder) {
          measure(el, 'placeholder', getComputedStyle(el, '::placeholder').color, input.placeholder, cs);
        }
        continue;
      }
      const text = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent || '')
        .join(' ')
        .trim();
      measure(el, 'text', cs.color, text, cs);
    }

    failures.sort((a, b) => a.ratio - b.ratio);
    return { sampled, overImage, failures };
  });
}

export function reportContrast(route: string, theme: string, result: ContrastResult): string {
  const lines = result.failures.map(
    (f) =>
      `    ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}${f.disabled ? ', disabled' : ''}] ${f.selector}\n` +
      `      "${f.text}"\n` +
      `      ${f.foreground} on ${f.background} @ ${f.fontSize}px\n` +
      `      class="${f.classes}"`
  );
  return (
    `${route} [${theme}]: ${result.failures.length} of ${result.sampled} sampled ` +
    `element(s) below WCAG AA\n${lines.join('\n')}`
  );
}
