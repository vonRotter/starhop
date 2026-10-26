// Quick look: title, new game on Pebble, screenshots and console errors.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/shots/01-title.png' });
await page.click('#t-new');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/shots/02-pebble.png' });
console.log(await page.evaluate(() => JSON.stringify(window.__sh.info())));
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log('fps', fps);
console.log(errors.join('\n') || 'no console errors');
await browser.close();
