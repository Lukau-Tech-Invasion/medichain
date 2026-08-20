/**
 * WCAG 2.2 contrast-ratio arithmetic.
 *
 * This exists because "it looks fine on my monitor" is not a standard, and
 * because the failure it catches is one this project has shipped repeatedly:
 * text that is present in the DOM but not perceivable by a tired reader on a
 * dim screen. A clinician who cannot read a value is in the same position as
 * one who was never shown it.
 *
 * The numbers are not opinions. WCAG 2.2 success criterion 1.4.3 (Contrast,
 * Minimum) requires 4.5:1 for normal text and 3:1 for large text; 1.4.11
 * (Non-text Contrast) requires 3:1 for UI component boundaries and focus
 * indicators. Anything below those is a defect, not a taste difference.
 */

/** WCAG AA threshold for normal-size text. */
export const AA_NORMAL_TEXT = 4.5;
/** WCAG AA threshold for large text (>=18.66px bold, or >=24px). */
export const AA_LARGE_TEXT = 3;
/** WCAG AA threshold for UI component boundaries and focus indicators. */
export const AA_NON_TEXT = 3;

/** Expand `#abc` to `#aabbcc`; pass through six-digit hex unchanged. */
function normaliseHex(hex: string): string {
  const raw = hex.trim().replace(/^#/, '');
  if (raw.length === 3) {
    return raw
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (raw.length !== 6) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return raw;
}

/**
 * Relative luminance per WCAG. The 0.03928 branch is the sRGB transfer
 * function's linear segment near black — dropping it (a common shortcut)
 * overstates the contrast of very dark colours, which is precisely where a
 * dark theme lives.
 */
export function relativeLuminance(hex: string): number {
  const raw = normaliseHex(hex);
  const channel = (offset: number): number => {
    const value = parseInt(raw.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Contrast ratio between two colours: 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a pairing clears the given threshold. Defaults to normal text. */
export function meetsContrast(
  foreground: string,
  background: string,
  threshold: number = AA_NORMAL_TEXT
): boolean {
  return contrastRatio(foreground, background) >= threshold;
}

/**
 * The Tailwind values this project actually uses, resolved to hex.
 *
 * Kept here rather than read from the Tailwind config on purpose: a test that
 * derives its expectations from the same source as the code under test proves
 * only that the file parses. These are the palette's published values, so a
 * silent palette change fails the test rather than moving the goalposts with it.
 */
export const TAILWIND: Readonly<Record<string, string>> = Object.freeze({
  white: '#ffffff',
  'gray-50': '#f9fafb',
  'gray-100': '#f3f4f6',
  'gray-200': '#e5e7eb',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'gray-700': '#374151',
  'gray-800': '#1f2937',
  'gray-900': '#111827',
  'green-50': '#f0fdf4',
  'green-700': '#15803d',
  'green-800': '#166534',
  'red-50': '#fef2f2',
  'red-700': '#b91c1c',
  'red-800': '#991b1b',
  'amber-50': '#fffbeb',
  'amber-200': '#fde68a',
  'amber-800': '#92400e',
});

/** Look up a Tailwind token, failing loudly on a typo rather than returning undefined. */
export function tw(token: string): string {
  const hex = TAILWIND[token];
  if (!hex) {
    throw new Error(`Unknown Tailwind token: ${token}`);
  }
  return hex;
}
