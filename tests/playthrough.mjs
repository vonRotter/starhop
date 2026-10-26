// Scripted play-through: new game (with a Couch profile) -> take a quest -> scan and gather on
// Pebble -> autopilot to Bloom and land -> scan creatures, gather star fruit -> take off -> fly back
// -> land on the pad -> complete the quest -> reload and continue. Fails on any console error.
// Run against `npx vite preview --port 4173` (URL env to override).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL ?? 'http://localhost:4173/';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const info = () => page.evaluate(() => window.__sh.info());
const sh = (fn, ...args) => page.evaluate(([f, a]) => window.__sh[f](...a), [fn, args]);
let shot = 0;
const snap = async (name) => page.screenshot({ path: `${SHOTS}${String(++shot).padStart(2, '0')}-${name}.png` });
const step = (msg) => console.log(`• ${msg}`);
async function waitFor(pred, what, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const i = await info();
    if (pred(i)) return i;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(i)}`);
    await page.waitForTimeout(250);
  }
}
async function hold(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function scan(species) {
  for (let tries = 0; tries < 4; tries++) {
    if ((await info()).finds.includes(species)) return;
    if (!(await sh('goNear', species))) throw new Error(`no ${species} here`);
    await page.waitForTimeout(150);
    await hold('KeyF', 1500);
  }
  const i = await info();
  if (!i.finds.includes(species)) throw new Error(`could not scan ${species}`);
}
async function gather(kind, n) {
  for (let k = 0; k < n; k++) {
    const before = (await info()).inv[kind];
    if (!(await sh('goNear', kind))) throw new Error(`no ${kind} here`);
    await page.waitForTimeout(100);
    await hold('KeyE', 1200);
    const after = (await info()).inv[kind];
    if (after <= before) throw new Error(`gathering ${kind} failed`);
  }
}
async function talkAndClick() {
  await sh('goNear', 'pip');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#dialog.visible', { timeout: 5000 });
  await snap('dialog');
  await page.click('#dlg-buttons button.primary');
  await page.waitForTimeout(200);
}

try {
  step('title with a Couch profile');
  await page.goto(`${BASE}?profile=test1&name=Ada&return=${encodeURIComponent(BASE)}&lang=en`);
  await page.evaluate(() => localStorage.clear());
  await page.waitForTimeout(1500);
  if (!(await page.$('a[href]'))) throw new Error('no back button');
  await snap('title');
  await page.click('#t-new');
  await waitFor((i) => i.mode === 'foot' && i.where === 'pebble', 'start on Pebble');
  await sh('setSpeed', 3);

  step('talk to Pip, accept quest 1');
  await talkAndClick();
  let i = await info();
  if (!i.accepted || i.quest !== 0 || i.target !== 'bloom') throw new Error(`quest not accepted: ${JSON.stringify(i)}`);

  step('scan a Rockpup and gather a crystal on Pebble');
  await scan('rockpup');
  await snap('scanned-rockpup');
  await gather('crystal', 1);

  step('board, take off, autopilot to Bloom');
  await sh('goNear', 'ship');
  await page.keyboard.press('KeyE');
  await waitFor((i) => i.mode === 'air', 'take off');
  await page.waitForTimeout(800);
  await snap('takeoff');
  await page.keyboard.press('KeyZ');
  await waitFor((i) => i.mode === 'space' && !i.fading, 'reach space');
  await page.waitForTimeout(600);
  await snap('space');
  i = await info();
  if (!i.autopilot) await page.keyboard.press('KeyZ');
  await waitFor((i) => i.where === 'bloom', 'enter Bloom atmosphere', 240000);
  await page.waitForTimeout(1500);
  await snap('bloom-air');
  await waitFor((i) => i.mode === 'foot', 'land on Bloom', 120000);
  await page.waitForTimeout(500);
  await snap('bloom-landed');

  step('scan creatures and gather star fruit on Bloom');
  for (const s of ['bouncer', 'shellby', 'flutter']) await scan(s);
  await snap('bloom-scanned');
  await gather('fruit', 3);
  i = await info();
  if (!i.ready) throw new Error(`quest 1 should be ready: ${JSON.stringify(i)}`);
  await snap('bloom-ready');

  step('fly home to Pebble');
  await sh('goNear', 'ship');
  await page.keyboard.press('KeyE');
  await waitFor((i) => i.mode === 'air', 'take off from Bloom');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyZ');
  await waitFor((i) => i.where === 'pebble' && i.mode === 'foot', 'land on Pebble', 300000);
  await page.waitForTimeout(500);
  await snap('pebble-home');
  i = await info();
  if (Math.hypot(i.pos[0], i.pos[2]) > 12) throw new Error(`should have landed by the pad: ${JSON.stringify(i)}`);

  step('complete quest 1');
  await talkAndClick();
  await page.waitForSelector('#dialog.visible', { timeout: 5000 });
  await snap('quest2-offer');
  await page.click('#dlg-buttons button.primary');
  i = await info();
  if (i.quest !== 1 || !i.jetpack || !i.accepted) throw new Error(`quest 1 not completed: ${JSON.stringify(i)}`);

  step('jetpack');
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  const up = await info();
  await page.keyboard.up('Space');
  await snap('jetpack');
  console.log('  jetpack height', up.pos[1]);

  step('reload and continue');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(1500);
  if (!(await page.isVisible('#t-continue'))) throw new Error('no Continue button');
  await page.click('#t-continue');
  i = await waitFor((i) => i.mode === 'foot', 'continue');
  if (i.quest !== 1 || !i.jetpack || i.where !== 'pebble' || i.finds.length < 4) throw new Error(`save not restored: ${JSON.stringify(i)}`);
  await snap('continued');
  const otherProfile = await page.evaluate(() => Object.keys(localStorage));
  console.log('  storage keys', otherProfile.join(', '));

  step('quest log and Norwegian');
  await page.keyboard.press('KeyJ');
  await page.waitForSelector('#log.visible');
  await page.click('#log .tabs button[data-tab="finds"]');
  await snap('log-finds');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause.visible');
  await page.click('#p-no');
  await page.click('#p-resume');
  await page.waitForTimeout(500);
  await snap('norsk');
} catch (e) {
  await snap('failure');
  console.error('FAILED:', e.message);
  errors.push(`test: ${e.message}`);
}
console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nOK: no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
