// Screenshots of every planet surface (visual check) plus console errors.
import { chromium } from 'playwright';
const BASE = process.env.URL ?? 'http://localhost:4173/';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.waitForTimeout(1000);
await page.click('#t-new');
await page.waitForTimeout(1000);
for (const id of ['frost', 'dune', 'bloom', 'pebble']) {
  await page.evaluate((id) => window.__sh.visit(id), id);
  await page.waitForTimeout(1500);
  const sp = await page.evaluate(() => window.__sh.speciesHere());
  if (sp[0]) await page.evaluate((s) => window.__sh.goNear(s), sp[0]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}planet-${id}.png` });
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}planet-${id}-high.png` });
}
console.log(errors.join('\n') || 'no console errors');
await browser.close();
