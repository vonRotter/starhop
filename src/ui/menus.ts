import { t } from '../core/i18n';
import { NODE_COUNT, PLANETS, SPECIES, type PlanetId, type ResourceId } from '../game/planets';
import { NPC_HOME, QUESTS, RACE_MEDALS, RECIPES, canAfford, owns, questDone, type GameState, type NpcId, type Recipe } from '../game/state';

export type LogTab = 'quests' | 'finds' | 'planets' | 'gear';

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const RES_ICON: Record<ResourceId, string> = { crystal: '💎', ice: '🧊', fruit: '⭐' };
const cap = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

/** The three completion stars of a planet: scanned all, collected all, quests done. */
export function planetStars(s: GameState, p: PlanetId): [boolean, boolean, boolean] {
  const scan = SPECIES.filter((x) => x.planet === p).every((x) => s.finds.includes(x.id));
  const got = s.got.filter((u) => u.startsWith(`${p}.`)).length >= NODE_COUNT[p];
  const quests = (Object.values(QUESTS).flat() as { id: string; planet: PlanetId }[]).filter((q) => q.planet === p).every((q) => questDone(s, q.id));
  return [scan, got, quests];
}

export function renderLog(s: GameState, tab: LogTab, pics: Record<string, string>): string {
  const img = (k: string): string => (pics[k] ? `<img src="${pics[k]}" alt="">` : '');
  if (tab === 'quests') {
    let html = '';
    for (const npc of Object.keys(QUESTS) as NpcId[]) {
      const st = s.npc[npc];
      if (npc === 'bolt' && st.i === 0 && !st.acc && !s.visited.includes('bloom')) continue;
      QUESTS[npc].forEach((q, i) => {
        const done = i < st.i;
        const now = i === st.i && st.acc;
        if (i > st.i) return;
        if (i === st.i && !st.acc) {
          html += `<div class="qcard done"><h3>💬 ${npc === 'pip' ? t('talkToPip') : t('talkToBolt')}</h3></div>`;
          return;
        }
        html += `<div class="qcard${done ? ' done' : ''}"><span class="tag2">${done ? t('questDone') : now ? t('questNow') : ''}</span><h3>${t(q.title)}</h3>`;
        if (!done) for (const o of q.objectives(s)) html += `<div>${o.icon} ${t(o.label)} ${o.need > 1 ? `${o.have}/${o.need}` : ''} ${o.have >= o.need ? '✓' : ''}</div>`;
        html += `<div>🎁 ${t(q.reward)} · 💬 ${t(`${npc}Name`)} (${t(NPC_HOME[npc])})</div></div>`;
      });
    }
    if (s.npc.pip.i >= QUESTS.pip.length && s.npc.bolt.i >= QUESTS.bolt.length) html += `<div class="qcard"><h3>★ ${t('allQuestsDone')}</h3></div>`;
    if (s.raceBest !== null) {
      const medal = s.raceBest <= RACE_MEDALS[0] ? '🥇' : s.raceBest <= RACE_MEDALS[1] ? '🥈' : s.raceBest <= RACE_MEDALS[2] ? '🥉' : '';
      html += `<div class="qcard"><h3>🏁 ${t('race')}: ${medal} ${t('best')} ${s.raceBest.toFixed(1)} s</h3></div>`;
    }
    return html;
  }
  if (tab === 'finds') {
    const n = s.finds.length;
    let html = `<p><b>${t('found', { n, m: SPECIES.length })}</b></p><div class="finds">`;
    for (const p of PLANETS) {
      html += `<h3>${t(p.id)}</h3>`;
      for (const sp of SPECIES.filter((x) => x.planet === p.id)) {
        const known = s.finds.includes(sp.id);
        html += `<div class="find${known ? '' : ' unknown'}" data-sp="${sp.id}">${img(sp.id) || `<div class="blob" style="background:${css(sp.color)}"></div>`}${known ? t(sp.id) : t('unknown')}<small>${sp.kind === 'creature' ? '🐾' : '🌱'}</small></div>`;
      }
    }
    html += `</div><h3>${t('resources')}</h3><div class="res">`;
    for (const r of ['crystal', 'ice', 'fruit'] as ResourceId[]) {
      html += `<div class="find">${img(r)}${RES_ICON[r]} ${t(r)} · ${s.inv[r]}<small>${t(`uses${cap(r)}`)}</small></div>`;
    }
    return html + '</div>';
  }
  if (tab === 'planets') {
    let html = '';
    for (const p of PLANETS) {
      const [a, b, c] = planetStars(s, p.id);
      const star = (on: boolean): string => `<span class="${on ? '' : 'off'}">⭐</span>`;
      const seen = s.visited.includes(p.id);
      html += `<div class="pcard"><div class="dot" style="background:${css(p.atmosphere)}"></div><div>${t(p.id)}${seen ? '' : ' 🔒'}<small>${t(`${p.id}Desc`)}</small><small>🔍 ${t('starScan')} ${a ? '✓' : ''} · 🧺 ${t('starCollect')} ${b ? '✓' : ''} · 💬 ${t('starQuests')} ${c ? '✓' : ''}</small></div><div class="stars">${star(a)}${star(b)}${star(c)}</div></div>`;
    }
    return html;
  }
  const gear: [string, string, boolean][] = [
    ['🚀', 'gearShip', true],
    ['🔍', s.scanner2 ? 'gearScanner2' : 'gearScanner', true],
    ['🎒', s.upgrades.includes('superjet') ? 'gearSuperjet' : 'gearJetpack', s.jetpack],
    ['🌀', 'gearHyper', s.hyperdrive],
    ['⚡', 'gearBoost', s.upgrades.includes('boost')],
    ['🔋', 'gearTank', s.upgrades.includes('tank')],
    ['🫧', 'gearSuit', s.upgrades.includes('suit')],
  ];
  return gear.map(([ic, k, on]) => `<div class="gear${on ? '' : ' locked'}"><span class="ic">${ic}</span>${t(k)}${on ? '' : ` — ${t('gearLocked')}`}</div>`).join('');
}

const NAME: Record<string, string> = {
  boost: 'upBoost',
  tank: 'upTank',
  suit: 'upSuit',
};
export const itemName = (r: { id: string; kind: string }): string =>
  t(r.kind === 'upgrade' ? NAME[r.id] : r.kind === 'paint' ? `paint${cap(r.id)}` : `hat${cap(r.id)}`);

const costText = (r: Recipe): string =>
  (Object.entries(r.cost) as [ResourceId, number][]).map(([k, n]) => `${RES_ICON[k]}${n}`).join(' ');

/** The workbench: upgrades, ship paint and hats as buttons (data-item = kind:id). */
export function renderCraft(s: GameState, paintCss: (id: string) => string): string {
  const btn = (kind: 'upgrade' | 'paint' | 'hat', id: string, icon: string, r?: Recipe): string => {
    const have = owns(s, kind, id);
    const on = (kind === 'paint' && s.paint === id) || (kind === 'hat' && s.hat === id);
    let sub: string;
    let cls = '';
    if (on) {
      sub = t('wearing');
      cls = 'on';
    } else if (have) {
      sub = kind === 'upgrade' ? `✓ ${t('owned')}` : t('owned');
      cls = 'have';
    } else if (r?.plan && !s.plans.includes(r.id as never)) {
      sub = `🔒 ${t('needPlan')}`;
      cls = 'cant';
    } else {
      sub = r ? costText(r) : '';
      if (r && !canAfford(s, r)) cls = 'cant';
    }
    const face = kind === 'paint' ? `<span class="ic"><span class="sw" style="background:${paintCss(id)}"></span></span>` : `<span class="ic">${icon}</span>`;
    return `<button class="${cls}" data-item="${kind}:${id}">${face}${itemName({ id, kind })}<small>${sub}</small></button>`;
  };
  let html = `<h3>${t('benchUpgrades')}</h3><div class="items">`;
  for (const r of RECIPES.filter((x) => x.kind === 'upgrade')) html += btn('upgrade', r.id, r.icon, r);
  html += `</div><h3>${t('benchPaint')}</h3><div class="items">`;
  html += btn('paint', 'coral', '🎨');
  for (const r of RECIPES.filter((x) => x.kind === 'paint')) html += btn('paint', r.id, r.icon, r);
  if (s.paints.includes('gold')) html += btn('paint', 'gold', '🎨');
  html += `</div><h3>${t('benchHats')}</h3><div class="items">`;
  html += btn('hat', 'none', '🙂');
  for (const r of RECIPES.filter((x) => x.kind === 'hat')) html += btn('hat', r.id, r.icon, r);
  if (s.hats.includes('welder')) html += btn('hat', 'welder', '🔧');
  if (s.hats.includes('halo')) html += btn('hat', 'halo', '💫');
  return html + '</div>';
}
