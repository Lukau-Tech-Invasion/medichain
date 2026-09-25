import { type Page } from '@playwright/test';

/**
 * The measurements, separated from the specs that assert on them.
 *
 * `contrast.spec.ts` grew a 100-line in-page auditor and `accessibility.spec.ts`
 * grew another for target size. Auditing five accounts instead of one meant
 * either copying both a third time or moving them here. Copying a measurement
 * is how two files start disagreeing about what passes.
 */

// Contrast measurement lives in `client/shared/src/testing/contrastAudit.ts`,
// shared with the patient app. This file carried a narrower copy that
// skipped form-control values, <div> text and translucent backgrounds.
export {
  auditContrast,
  reportContrast,
  setTheme,
  freezeMotion,
  type ContrastFailure,
  type ContrastResult,
} from '../../shared/src/testing/contrastAudit';

export interface UndersizedTarget {
  selector: string;
  w: number;
  h: number;
  text: string;
}

/** WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA — 24 x 24 CSS px. */
export async function auditTargetSize(page: Page): Promise<UndersizedTarget[]> {
  return page.evaluate(() => {
    const MIN = 24;
    const results: UndersizedTarget[] = [];
    document
      .querySelectorAll<HTMLElement>('button, a[href], input, select, [role="button"]')
      .forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // A visually-hidden control is clipped to about 1px until it is focused.
        // The skip link is the canonical case: measured while hidden it reports
        // 16x8 and looks like a violation, when in reality it is not a target at
        // all until a keyboard user reaches it.
        const clipped =
          cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
          cs.clipPath === 'inset(50%)' ||
          (r.width <= 2 && r.height <= 2);
        if (clipped || el.className.includes('sr-only')) return;
        // SC 2.5.8 exempts targets in a sentence ("inline"), and those whose
        // spacing gives them a 24px exclusion zone. Approximate the inline
        // exception by skipping anchors laid out inline inside text.
        if (el.tagName === 'A' && cs.display === 'inline') return;

        // A checkbox or radio inside a <label> is not the target — the label is.
        // Clicking anywhere in it toggles the control, so the label's box is
        // what a user has to hit, and that is what SC 2.5.8 measures.
        //
        // This matters: a native unstyled checkbox is 13x13 in every browser,
        // and 137 of them were reported across four screens. Growing each to
        // 24px would be a large visual change made to satisfy a measurement
        // that was asking the wrong element. Where the label is *also* under
        // 24px the pair is still reported, which is the real failure.
        let box = r;
        if (el.tagName === 'INPUT') {
          const type = (el as HTMLInputElement).type;
          if (type === 'checkbox' || type === 'radio') {
            // Either association counts. A wrapping <label> and a sibling
            // `<label for="...">` both toggle the control when clicked, so both
            // are part of the target a user has to hit.
            const wrapper = el.closest('label');
            const associated = el.id
              ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)
              : null;
            const label = wrapper || associated;
            if (label) {
              const lr = label.getBoundingClientRect();
              // The union of the two boxes: with a sibling label they sit side
              // by side, and the pair is what the user aims at.
              box = {
                width: Math.max(r.right, lr.right) - Math.min(r.left, lr.left),
                height: Math.max(r.bottom, lr.bottom) - Math.min(r.top, lr.top),
              } as DOMRect;
            }
          }
        }
        const { width: w, height: h } = box;
        if (w < MIN || h < MIN) {
          const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
          results.push({
            selector: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
            w: Math.round(w),
            h: Math.round(h),
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
          });
        }
      });
    return results;
  });
}

