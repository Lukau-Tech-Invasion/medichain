// Render each mockup page to a PNG at its device size.
// Needs playwright from client/node_modules: copy into client/ and point `here` at docs/ux-mockups.
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const pages = readdirSync(here).filter((f) => /^[pc]\d.*\.html$/.test(f) && (!only.length || only.some((o) => f.startsWith(o))));
const browser = await chromium.launch();
for (const file of pages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(here, file)).href);
  // A page built in a .phone frame is captured at phone size.
  if (await page.$('.phone')) await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(here, 'screens', file.replace('.html', '.png')), fullPage: true });
  await page.close();
  console.log('captured', file);
}
await browser.close();
