import { t } from '../core/i18n';
import { PLANETS, SPECIES } from '../game/planets';
import { QUESTS, type GameState } from '../game/state';

export type LogTab = 'quests' | 'finds' | 'gear';

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export function renderLog(s: GameState, tab: LogTab): string {
  if (tab === 'quests') {
    let html = '';
    QUESTS.forEach((q, i) => {
      const done = i < s.quest;
      const now = i === s.quest && s.accepted;
      if (i > s.quest || (i === s.quest && !s.accepted)) {
        html += `<div class="qcard done"><h3>${i === s.quest ? '💬 ' + t('talkToPip') : '🔒 ' + t('questLater')}</h3></div>`;
        return;
      }
      html += `<div class="qcard${done ? ' done' : ''}"><span class="tag2">${done ? t('questDone') : now ? t('questNow') : ''}</span><h3>${t(q.title)}</h3>`;
      if (!done) for (const o of q.objectives(s)) html += `<div>${o.icon} ${t(o.label)} ${o.need > 1 ? `${o.have}/${o.need}` : ''} ${o.have >= o.need ? '✓' : ''}</div>`;
      html += `<div>🎁 ${t('reward')}: ${t(q.reward)}</div></div>`;
    });
    if (s.quest >= QUESTS.length) html += `<div class="qcard"><h3>★ ${t('allQuestsDone')}</h3></div>`;
    return html;
  }
  if (tab === 'finds') {
    const n = s.finds.length;
    let html = `<p><b>${t('found', { n, m: SPECIES.length })}</b></p><div class="finds">`;
    for (const sp of SPECIES) {
      const known = s.finds.includes(sp.id);
      html += `<div class="find${known ? '' : ' unknown'}"><div class="blob" style="background:${css(sp.color)}"></div>${known ? t(sp.id) : t('unknown')}<small>${sp.kind === 'creature' ? '🐾' : '🌱'} ${t(sp.planet)}</small></div>`;
    }
    return html + '</div>';
  }
  const gear: [string, string, boolean][] = [
    ['🚀', 'gearShip', true],
    ['🔍', s.scanner2 ? 'gearScanner2' : 'gearScanner', true],
    ['🎒', 'gearJetpack', s.jetpack],
    ['🌀', 'gearHyper', s.hyperdrive],
  ];
  let html = gear.map(([ic, k, on]) => `<div class="gear${on ? '' : ' locked'}"><span class="ic">${ic}</span>${t(k)}${on ? '' : ` — ${t('gearLocked')}`}</div>`).join('');
  html += '<p>';
  for (const p of PLANETS) html += `<b>${t(p.id)}</b>: ${t(`${p.id}Desc`)}${s.visited.includes(p.id) ? ' ✓' : ''}<br>`;
  return html + '</p>';
}
