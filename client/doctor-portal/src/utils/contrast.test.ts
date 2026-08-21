import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  meetsContrast,
  relativeLuminance,
  tw,
  AA_NORMAL_TEXT,
  AA_LARGE_TEXT,
  AA_NON_TEXT,
} from '@medichain/shared';

describe('contrast arithmetic', () => {
  it('matches the WCAG reference extremes', () => {
    // Black on white is the definitional maximum.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    // A colour against itself carries no information.
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
    // Order must not matter: contrast is symmetric.
    expect(contrastRatio('#1f2937', '#f9fafb')).toBeCloseTo(
      contrastRatio('#f9fafb', '#1f2937'),
      10
    );
  });

  it('uses the linear segment of the sRGB transfer function near black', () => {
    // #050505 is below the 0.03928 breakpoint. Skipping that branch — a common
    // shortcut — overstates the luminance of very dark colours, which is
    // exactly where a dark theme lives.
    expect(relativeLuminance('#050505')).toBeCloseTo(0.001517, 5);
  });

  it('expands shorthand hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });

  it('rejects a malformed colour instead of silently scoring it', () => {
    expect(() => contrastRatio('not-a-colour', '#fff')).toThrow();
    expect(() => tw('gray-999')).toThrow(/Unknown Tailwind token/);
  });
});

/**
 * The pairings below are the ones actually rendered on clinical screens.
 *
 * This is a regression gate, not an aspiration. Every entry marked FIXED was
 * measured failing in a shipped build: the analytics operational panel used
 * `gray-400` on `gray-50` for the "No data source" label and for the em dash
 * standing in for an absent metric — **2.43:1**, against a 4.5:1 requirement.
 * Absent data should be unemphasised, not illegible; those are different
 * things, and conflating them is how a reader mistakes "not measured" for
 * "nothing is wrong here".
 */
describe('clinical surfaces meet WCAG 2.2 AA', () => {
  const cases: Array<[string, string, string, number]> = [
    // [description, foreground, background, threshold]
    ['analytics: unmeasured row label', 'gray-800', 'gray-100', AA_NORMAL_TEXT],
    ['analytics: "No data source" (FIXED, was 2.43:1)', 'gray-600', 'gray-100', AA_NORMAL_TEXT],
    ['analytics: absent-metric dash (FIXED, was 2.43:1)', 'gray-600', 'gray-100', AA_NORMAL_TEXT],
    ['analytics: metric label on a normal row', 'gray-800', 'green-50', AA_NORMAL_TEXT],
    ['analytics: metric hint text', 'gray-600', 'green-50', AA_NORMAL_TEXT],
    ['analytics: normal metric value', 'green-800', 'green-50', AA_NORMAL_TEXT],
    ['analytics: urgent metric value', 'red-800', 'red-50', AA_NORMAL_TEXT],
    ['analytics: urgent left border', 'red-700', 'red-50', AA_NON_TEXT],
    ['settings: incomplete-theme notice', 'amber-800', 'amber-50', AA_NORMAL_TEXT],
    ['general: body text on white', 'gray-900', 'white', AA_NORMAL_TEXT],
    ['general: secondary text on white', 'gray-600', 'white', AA_NORMAL_TEXT],
  ];

  it.each(cases)('%s', (_label, fg, bg, threshold) => {
    const ratio = contrastRatio(tw(fg), tw(bg));
    expect(
      ratio,
      `${fg} on ${bg} measured ${ratio.toFixed(2)}:1, needs ${threshold}:1`
    ).toBeGreaterThanOrEqual(threshold);
  });

  /**
   * The pairings that were wrong, pinned as wrong.
   *
   * Without this, someone "tidying" the palette back toward the lighter greys
   * would reintroduce the exact defect and every other test would still pass.
   * A regression test that only asserts the fix is half a test.
   */
  it('still recognises the combinations that failed, so they cannot come back unnoticed', () => {
    expect(meetsContrast(tw('gray-400'), tw('gray-50'))).toBe(false);
    expect(contrastRatio(tw('gray-400'), tw('gray-50'))).toBeLessThan(2.5);
    // It does not even clear the *large text* bar, so no font-size argument
    // rescues it.
    expect(meetsContrast(tw('gray-400'), tw('gray-50'), AA_LARGE_TEXT)).toBe(false);
  });
});
