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
// a fake gamepad the test can drive (standard mapping)
await page.addInitScript(() => {
  const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  window.__padOn = false;
  navigator.getGamepads = () => (window.__padOn ? [pad] : []);
});
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
    await sh('setAir', 1);
    const before = (await info()).inv[kind];
    if (!(await sh('goNear', kind))) throw new Error(`no ${kind} here`);
    await page.waitForTimeout(100);
    await hold('KeyE', 1200);
    const after = (await info()).inv[kind];
    if (after <= before) throw new Error(`gathering ${kind} failed at ${(await info()).pos} (prompt: ${await page.textContent('#prompt')})`);
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

  let i;
  if (!process.env.ONLY_M2) {
  step('talk to Pip, accept quest 1');
  await talkAndClick();
  i = await info();
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
  await sh('setSpeed', 3);
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

  step('gamepad: walk with the left stick, board with X');
  await page.evaluate(() => { window.__padOn = true; window.__pad.axes[1] = -1; });
  const p0 = (await info()).pos;
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__pad.axes[1] = 0; });
  const p1 = (await info()).pos;
  if (Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 2) throw new Error(`pad did not move the astronaut ${p0} -> ${p1}`);
  await snap('pad-controls');
  await sh('goNear', 'ship');
  await page.evaluate(() => { window.__pad.buttons[2].pressed = true; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__pad.buttons[2].pressed = false; });
  await waitFor((i) => i.mode === 'air', 'board with pad X');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__pad.axes[3] = 0.8; window.__pad.buttons[0].pressed = true; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__pad.axes[3] = 0; window.__pad.buttons[0].pressed = false; });
  await snap('pad-flight');
  await page.evaluate(() => { window.__padOn = false; });

  if (process.env.FULL) {
    step('quest 2: autopilot to Frost, gather ice (some on pillars with the jetpack)');
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.where === 'frost' && i.mode === 'foot', 'land on Frost', 400000);
    await snap('frost-landed');
    await gather('ice', 3);
    for (let k = 0; k < 2; k++) {
      const pil = await sh('pillar');
      await page.waitForTimeout(200);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('Space');
      await page.waitForTimeout(2500);
      await page.keyboard.up('Space');
      await page.waitForTimeout(600);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(400);
      const i2 = await info();
      console.log(`  pillar top ${pil.top.toFixed(1)}, astronaut y ${i2.pos[1]}`);
      if (k === 0) await snap('frost-pillar');
      if (i2.pos[1] < pil.top - 1) throw new Error('jetpack did not reach the pillar top');
      const before = i2.inv.ice;
      await sh('goNear', 'ice', true);
      await hold('KeyE', 1200);
      if ((await info()).inv.ice <= before) throw new Error('could not collect ice on the pillar');
    }
    await waitFor((i) => i.ready, 'quest 2 ready', 5000);
    await sh('goNear', 'ship');
    await page.keyboard.press('KeyE');
    await waitFor((i) => i.mode === 'air', 'take off from Frost');
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.where === 'pebble' && i.mode === 'foot', 'back on Pebble', 400000);
    await talkAndClick();
    await page.waitForSelector('#dialog.visible', { timeout: 5000 });
    await page.click('#dlg-buttons button.primary');
    i = await info();
    if (i.quest !== 2 || !i.hyperdrive || i.target !== 'dune') throw new Error(`quest 2 not completed: ${JSON.stringify(i)}`);

    step('quest 3: hyperjump to Dune, find the probe');
    await sh('goNear', 'ship');
    await page.keyboard.press('KeyE');
    await waitFor((i) => i.mode === 'air', 'take off');
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.mode === 'space' && !i.fading, 'space', 200000);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(600);
    await snap('hyperjump');
    await waitFor((i) => i.mode === 'space' && !i.fading && Math.hypot(i.pos[0] - 6200, i.pos[2] - 5600) < 1500, 'arrive at Dune', 60000);
    await snap('dune-space');
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.where === 'dune' && i.mode === 'foot', 'land on Dune', 400000);
    await sh('goNear', 'probe');
    await snap('probe');
    await page.keyboard.press('KeyE');
    await waitFor((i) => i.ready, 'probe found', 5000);
    await sh('goNear', 'ship');
    await page.keyboard.press('KeyE');
    await waitFor((i) => i.mode === 'air', 'take off from Dune');
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.mode === 'space' && !i.fading, 'space', 200000);
    await page.keyboard.press('KeyH');
    await waitFor((i) => i.mode === 'space' && !i.fading && Math.hypot(i.pos[0] - 2400, i.pos[2] - 600) < 1000, 'jump home', 60000);
    await page.keyboard.press('KeyZ');
    await waitFor((i) => i.where === 'pebble' && i.mode === 'foot', 'land home', 400000);
    await talkAndClick();
    i = await info();
    if (i.quest !== 3) throw new Error(`quest 3 not completed: ${JSON.stringify(i)}`);
    await snap('all-done');
  }
  } // ONLY_M2
  if (!process.env.SKIP_M2) {
    step('milestone 2: a milestone-1 save (other profile) continues');
    const m1save = { v: 1, where: 'pebble', shipPos: [0, 0, 0], shipQuat: [0, 0, 0, 1], land: [0, 0], inv: { crystal: 2, ice: 1, fruit: 1 }, finds: ['rockpup', 'bouncer'], quest: 1, accepted: true, probe: false, jetpack: true, hyperdrive: false, scanner2: false, target: 'frost', visited: ['pebble', 'bloom'] };
    await page.goto(`${BASE}?profile=m1&name=Ola&return=${encodeURIComponent(BASE)}&lang=en`);
    await page.evaluate((s) => localStorage.setItem('p.m1.starhop.save', JSON.stringify(s)), m1save);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.click('#t-continue');
    i = await waitFor((i) => i.mode === 'foot', 'continue the old save');
    if (i.quest !== 1 || !i.accepted || !i.jetpack || i.inv.crystal !== 2 || i.finds.length !== 2 || i.bolt.i !== 0) throw new Error(`v1 save not migrated: ${JSON.stringify(i)}`);
    await sh('setSpeed', 3);

    step('options: invert, mouse speed, graphics, music');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause.visible');
    await page.click('#p-options');
    await page.waitForSelector('#options.visible');
    await page.click('#o-invert');
    await page.click('#o-mouse');
    await page.click('#o-quality');
    await page.click('#o-quality');
    await page.click('#o-music');
    await snap('options');
    let q = await sh('quality');
    if (q.q !== 'low' || q.shadows || q.ratio !== 0.75) throw new Error(`graphics option not applied: ${JSON.stringify(q)}`);
    const opts = await page.evaluate(() => ['invert', 'mouse', 'quality', 'music'].map((k) => localStorage.getItem(`p.m1.starhop.${k}`)));
    if (opts.join() !== '1,1.4,low,0') throw new Error(`options not saved: ${opts}`);
    await page.click('#o-back');
    await page.waitForSelector('#pause.visible');
    await page.click('#p-resume');
    await page.waitForTimeout(400);
    await snap('low-quality');
    // back to high graphics and music on for the rest
    await page.keyboard.press('Escape');
    await page.click('#p-options');
    await page.click('#o-quality');
    await page.click('#o-music');
    await page.click('#o-invert');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause.visible');
    await page.click('#p-resume');
    q = await sh('quality');
    if (q.q !== 'high' || !q.shadows) throw new Error(`graphics back to high failed: ${JSON.stringify(q)}`);

    const talkTo = async (who) => {
      await sh('goNear', who);
      await page.waitForTimeout(150);
      await page.keyboard.press('KeyE');
      await page.waitForSelector('#dialog.visible', { timeout: 5000 });
      await snap(`talk-${who}`);
      const text = await page.textContent('#dlg-text');
      await page.click('#dlg-buttons button.primary');
      await page.waitForTimeout(250);
      return text;
    };

    step('Bolt on Bloom: fix the ship (crystals and star fruit)');
    await sh('visit', 'bloom');
    await waitFor((i) => i.where === 'bloom' && i.mode === 'foot', 'on Bloom');
    if ((await info()).nodes !== 11) throw new Error('Bloom node count changed (NODE_COUNT)');
    await talkTo('bolt');
    i = await info();
    if (!i.bolt.acc || i.bolt.i !== 0) throw new Error(`Bolt quest not accepted: ${JSON.stringify(i)}`);
    await gather('crystal', 1);
    await gather('fruit', 2);
    await waitFor((i) => i.bolt.ready, 'Bolt quest 1 ready', 5000);
    await talkTo('bolt');
    await page.waitForSelector('#dialog.visible', { timeout: 5000 });
    await page.click('#dlg-buttons button.primary');
    i = await info();
    if (i.bolt.i !== 1 || !i.bolt.acc || !i.plans.includes('boost')) throw new Error(`Bolt quest 1 not done: ${JSON.stringify(i)}`);

    step('workbench on Pebble: boost upgrade, paint, hat');
    await sh('visit', 'pebble');
    await waitFor((i) => i.where === 'pebble' && i.mode === 'foot', 'on Pebble');
    await sh('give', 'crystal', 5);
    await sh('give', 'ice', 4);
    await sh('give', 'fruit', 2);
    await sh('goNear', 'bench');
    await page.waitForTimeout(150);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('#craft.visible', { timeout: 5000 });
    const e0 = (await info()).energy;
    await page.click('#c-body button[data-item="upgrade:boost"]');
    await page.click('#c-body button[data-item="paint:sky"]');
    await page.click('#c-body button[data-item="hat:party"]');
    await page.click('#c-body button[data-item="upgrade:tank"]'); // no plan yet: refused
    await snap('workbench');
    i = await info();
    if (!i.upgrades.includes('boost') || i.upgrades.includes('tank') || i.paint !== 'sky' || i.hat !== 'party') throw new Error(`crafting failed: ${JSON.stringify(i)}`);
    console.log('  energy', e0, '->', i.energy, 'inv', JSON.stringify(i.inv));
    await page.click('#c-close');
    await page.waitForTimeout(300);
    await sh('goNear', 'ship');
    await page.waitForTimeout(400);
    await snap('hat-and-paint');

    step('Frost: geyser sensors, slippery ice, running out of air');
    await sh('visit', 'frost');
    await waitFor((i) => i.where === 'frost' && i.mode === 'foot', 'on Frost');
    await page.waitForTimeout(400);
    if (!(await page.isVisible('#air.on'))) throw new Error('no air meter on Frost');
    for (let k = 0; k < 3; k++) {
      const before = (await info()).sensors.length;
      for (let tries = 0; tries < 30; tries++) {
        await sh('goNear', 'geyser');
        await sh('setAir', 1);
        const g = await sh('geyser');
        if (g && !g.erupting && g.timer > 1.7) {
          await page.keyboard.down('KeyE');
          for (let w = 0; w < 60; w++) {
            await page.waitForTimeout(100);
            if ((await info()).sensors.length > before || (await sh('geyser'))?.erupting) break;
          }
          await page.keyboard.up('KeyE');
          if ((await info()).sensors.length > before) break;
        }
        await page.waitForTimeout(250);
      }
      if ((await info()).sensors.length <= before) throw new Error(`could not place sensor ${k + 1} at ${(await info()).pos} ${JSON.stringify(await sh('geyser'))} (prompt: ${await page.textContent('#prompt')})`);
      if (k === 0) await snap('sensor');
    }
    await sh('setSpeed', 3);
    await sh('goNear', 'ice-patch');
    await page.waitForTimeout(200);
    await hold('KeyW', 500);
    const s0 = await info();
    const b0 = await sh('bean');
    await page.waitForTimeout(400);
    const b1 = await sh('bean');
    const slide = Math.hypot(b1[0] - b0[0], b1[2] - b0[2]);
    console.log('  on ice', s0.slippery, 'slide after letting go', slide.toFixed(2), 'm');
    if (slide < 0.3) throw new Error('no sliding on the ice');
    if (!s0.slippery) throw new Error('ice patch is not slippery');
    await snap('ice-patch');
    // walk away from the ship and run out of air
    await sh('goNear', 'geyser');
    await sh('give', 'fruit', 1);
    const inv0 = (await info()).inv;
    await sh('setAir', 0.05);
    await page.waitForTimeout(600);
    await snap('air-out');
    i = await waitFor((i) => !i.fading && i.air > 0.9, 'air refilled after running out', 15000);
    if (i.inv.fruit !== inv0.fruit - 1 || i.inv.ice !== inv0.ice - (inv0.ice > 0 ? 1 : 0)) throw new Error(`air loss should drop 1 of each: ${JSON.stringify(inv0)} -> ${JSON.stringify(i.inv)}`);
    const bp = await sh('bean');
    console.log('  back by the ship at', bp.map((x) => Math.round(x)).join(','));
    if (!i.bolt.ready) throw new Error(`sensors quest should be ready: ${JSON.stringify(i)}`);
    await sh('visit', 'bloom');
    await waitFor((i) => i.where === 'bloom' && i.mode === 'foot', 'on Bloom');
    await talkTo('bolt');
    await page.waitForSelector('#dialog.visible', { timeout: 5000 });
    await page.click('#dlg-buttons button.primary');
    i = await info();
    if (i.bolt.i !== 2 || !i.bolt.acc || !i.plans.includes('suit')) throw new Error(`Bolt quest 2 not done: ${JSON.stringify(i)}`);

    step('ring race in space');
    await sh('goNear', 'ship');
    await page.keyboard.press('KeyE');
    await waitFor((i) => i.mode === 'air', 'take off');
    await page.waitForTimeout(500);
    await snap('takeoff-camera');
    await sh('setTarget', 'pebble');
    await page.keyboard.press('KeyZ');
    await sh('setTarget', 'frost');
    await waitFor((i) => i.mode === 'space' && !i.fading, 'reach space', 200000);
    await sh('setSpeed', 1);
    await sh('raceStart');
    await sh('raceAuto', true);
    await waitFor((i) => i.race.running, 'race started', 20000);
    await page.waitForTimeout(3000);
    await snap('race');
    i = await waitFor((i) => i.raceBest !== null, 'race finished', 200000);
    await sh('raceAuto', false);
    console.log('  race time', i.raceBest);
    await snap('race-finish');
    await sh('setSpeed', 3);
    if (!i.bolt.ready) throw new Error(`race should win a medal (<= 75 s): ${i.raceBest}`);
    await sh('visit', 'bloom');
    await waitFor((i) => i.where === 'bloom' && i.mode === 'foot', 'on Bloom');
    await talkTo('bolt');
    await page.waitForSelector('#dialog.visible', { timeout: 5000 });
    const blocked = await page.textContent('#dlg-text');
    if (!/hyperdrive/i.test(blocked)) throw new Error(`Bolt should ask for a hyperdrive first: ${blocked}`);
    await page.click('#dlg-buttons button.primary');
    i = await info();
    if (i.bolt.i !== 3 || i.bolt.acc || !i.plans.includes('tank')) throw new Error(`Bolt quest 3 not done: ${JSON.stringify(i)}`);

    step('gears on Dune and a sandstorm');
    await sh('set', 'hyperdrive', true);
    await talkTo('bolt');
    if (!(await info()).bolt.acc) throw new Error('Bolt quest 4 not accepted');
    await sh('visit', 'dune');
    await waitFor((i) => i.where === 'dune' && i.mode === 'foot', 'on Dune');
    for (let k = 0; k < 3; k++) {
      await sh('setAir', 1);
      if (!(await sh('goNear', 'gear'))) throw new Error(`gear ${k + 1} missing`);
      await page.waitForTimeout(150);
      if (k === 0) await snap('gear');
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(250);
    }
    await sh('storm');
    await waitFor((i) => i.storm && i.storm.amount > 0.97, 'sandstorm', 30000);
    await sh('mesa', true);
    await sh('setAir', 1);
    const w0 = await info();
    await page.waitForTimeout(700);
    const w1 = await info();
    const drift = Math.hypot(w1.pos[0] - w0.pos[0], w1.pos[2] - w0.pos[2]);
    await snap('sandstorm');
    await sh('mesa', false);
    await page.waitForTimeout(150);
    const h0 = await info();
    await page.waitForTimeout(700);
    const h1 = await info();
    const drift2 = Math.hypot(h1.pos[0] - h0.pos[0], h1.pos[2] - h0.pos[2]);
    console.log(`  storm fog ${w0.storm.fogFar} m, wind drift ${drift.toFixed(1)} m exposed, ${drift2.toFixed(1)} m sheltered (${h1.storm.sheltered})`);
    await snap('sheltered');
    if (w0.storm.fogFar > 150 || drift < 1 || drift2 > 0.3 || !h1.storm.sheltered) throw new Error('sandstorm visibility, wind or shelter wrong');
    i = await info();
    if (i.gears.length !== 3 || !i.bolt.ready) throw new Error(`gears not found: ${JSON.stringify(i)}`);
    await sh('visit', 'bloom');
    await waitFor((i) => i.where === 'bloom' && i.mode === 'foot', 'on Bloom');
    await talkTo('bolt');
    i = await info();
    if (i.bolt.i !== 4 || !i.upgrades.includes('superjet')) throw new Error(`Bolt quest 4 not done: ${JSON.stringify(i)}`);

    step("Pip's star party (quest 4)");
    await sh('set', 'npc', { pip: { i: 3, acc: false }, bolt: { i: 4, acc: false } });
    await sh('visit', 'pebble');
    await waitFor((i) => i.where === 'pebble' && i.mode === 'foot', 'on Pebble');
    await talkTo('pip');
    await sh('give', 'fruit', 4);
    await sh('give', 'ice', 4);
    await waitFor((i) => i.ready, 'party quest ready', 5000);
    await talkTo('pip');
    i = await info();
    if (i.quest !== 4 || i.hat !== 'crown') throw new Error(`Pip quest 4 not done: ${JSON.stringify(i)}`);
    await sh('useItem', 'paint:gold');
    await sh('goNear', 'ship');
    await page.waitForTimeout(300);
    await snap('crown-gold');

    step('discovery log pictures and planet stars');
    await page.keyboard.press('KeyJ');
    await page.waitForSelector('#log.visible');
    await page.click('#log .tabs button[data-tab="finds"]');
    await page.waitForTimeout(300);
    const pics = await page.$$eval('#log-body img', (els) => els.map((e) => e.getAttribute('src') || ''));
    console.log(`  ${pics.length} pictures, sizes ${pics.map((p) => p.length).slice(0, 4).join(', ')}...`);
    if (pics.length < 15 || pics.some((p) => !p.startsWith('data:image/png') || p.length < 1500)) throw new Error('log thumbnails missing or blank');
    await snap('log-pictures');
    await page.click('#log .tabs button[data-tab="planets"]');
    await page.waitForTimeout(200);
    await snap('log-planets');
    await page.click('#log .tabs button[data-tab="gear"]');
    await page.waitForTimeout(200);
    await snap('log-gear');
    await page.click('#log-close');

    step('reload keeps the milestone-2 things');
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.click('#t-continue');
    i = await waitFor((i) => i.mode === 'foot', 'continue');
    if (i.paint !== 'gold' || i.hat !== 'crown' || !i.upgrades.includes('boost') || i.bolt.i !== 4 || i.sensors.length !== 3) throw new Error(`milestone-2 save lost: ${JSON.stringify(i)}`);
    await page.keyboard.press('Escape');
    await page.click('#p-no');
    await page.click('#p-resume');
    await sh('goNear', 'bench');
    await page.keyboard.press('KeyE');
    await page.waitForSelector('#craft.visible');
    await snap('workbench-norsk');
    await page.click('#c-close');
  }
} catch (e) {
  await snap('failure');
  console.error('FAILED:', e.message);
  errors.push(`test: ${e.message}`);
}
console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nOK: no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
