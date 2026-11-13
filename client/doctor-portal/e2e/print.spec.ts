import { test, expect, type Page } from '@playwright/test';
import { portalPath } from './portal-path';
import { fixturePatientId, pickPatientById, settle, signIn, type RoleName } from './support';

/**
 * Native printing of every printable record: the printed page carries the
 * selected document and nothing of the application around it.
 *
 * For each screen with a print action, the spec opens a saved record's print
 * preview, switches the page to print media, and checks what a printer would
 * receive: the document's title and content are visible, the sidebar and
 * header navigation are not, and Chromium renders it to a PDF of at least one
 * page. `page.pdf()` is the browser's own print pipeline, so a stylesheet that
 * hides the document or leaves the navigation in is caught here.
 *
 * Text is checked through `innerText` under print media, which honours the
 * print stylesheet's `display: none`; the PDF is checked for its page count.
 */

interface Printable {
  route: string;
  role: RoleName;
  /** Opens one saved record's print preview. */
  open: (page: Page) => Promise<void>;
  /** Text the printed document must carry. */
  title: RegExp;
}

async function clickFirst(page: Page, name: RegExp) {
  const control = page.getByRole('button', { name }).first();
  await expect(control, `no saved record offers ${name} on this screen`).toBeVisible({ timeout: 30000 });
  await control.click();
}

const PRINTABLE: Printable[] = [
  { route: '/history-physical', role: 'Doctor', title: /history|physical/i, open: (p) => clickFirst(p, /^print$/i) },
  { route: '/lab-result/latest', role: 'Doctor', title: /laboratory result/i, open: async (p) => {
    // The result page lists every submission and opens one in a dialog.
    await p.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, portalPath('/lab-result/latest'));
    const result = p.locator('main [role="button"]').first();
    await expect(result, 'no lab result to open').toBeVisible({ timeout: 30000 });
    await result.click();
    await clickFirst(p, /print lab result/i);
  } },
  { route: '/incident-report', role: 'Nurse', title: /incident report/i, open: (p) => clickFirst(p, /print incident report/i) },
  { route: '/intake-output', role: 'Nurse', title: /intake\/output summary/i, open: async (p) => {
    // The day's summary prints from the Trends tab.
    await p.getByRole('button', { name: /trends/i }).first().click();
    await clickFirst(p, /print/i);
  } },
  { route: '/ama', role: 'Doctor', title: /ama record/i, open: async (p) => {
    const row = p.locator('main [role="button"], main tr').filter({ hasText: /ama|against medical advice/i }).first();
    await row.click();
    await clickFirst(p, /print/i);
  } },
  { route: '/death-certificate', role: 'Doctor', title: /death certificate/i, open: (p) => clickFirst(p, /print/i) },
  { route: '/soap', role: 'Doctor', title: /soap note/i, open: async (p) => {
    // A patient's signed notes appear once the patient is chosen.
    await pickPatientById(p, '#soap-patient-id', fixturePatientId());
    // The form comes first (c3); earlier notes are folded beneath it.
    const earlier = p.getByRole('button', { name: /^show$/i }).first();
    await earlier.click({ timeout: 30000 });
    await clickFirst(p, /print note/i);
  } },
  { route: '/consult', role: 'Doctor', title: /consultation/i, open: async (p) => {
    // Answered consults are under "Completed".
    await p.getByRole('button', { name: /completed/i }).first().click().catch(() => undefined);
    await clickFirst(p, /print consultation/i);
  } },
  { route: '/progress-note', role: 'Doctor', title: /progress note/i, open: async (p) => {
    await p.locator('main [role="button"]').first().click();
    await clickFirst(p, /print note/i);
  } },
];

for (const item of PRINTABLE) {
  test(`${item.route} prints the selected record without the application`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, item.role, 0);
    if (!item.route.startsWith('/lab-result/')) await settle(page, item.route);
    await item.open(page);

    const preview = page.getByRole('dialog').filter({ hasText: item.title }).last();
    await expect(preview, 'the print preview did not open').toBeVisible({ timeout: 20000 });

    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => document.body.innerText);
    expect(printed, 'the printed page does not carry the document title').toMatch(item.title);
    const navigation = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('nav, header[role="banner"], aside'))
        .filter((el) => !el.closest('.record-print-root, .hp-record-document'))
        .some((el) => el.offsetParent !== null && el.innerText.trim().length > 0)
    );
    expect(navigation, 'the application navigation would be printed').toBe(false);
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.no-print')).some((el) => el.offsetParent !== null)
    );
    expect(buttons, 'the preview\'s own buttons would be printed').toBe(false);

    const pdf = await page.pdf({ format: 'A4', printBackground: false });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages, 'the print produced no pages').toBeGreaterThanOrEqual(1);
    test.info().annotations.push({ type: 'pdf', description: `${item.route}: ${pages} page(s), ${pdf.length} bytes` });

    await page.emulateMedia({ media: 'screen' });
  });
}
