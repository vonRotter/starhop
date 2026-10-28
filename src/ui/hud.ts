import * as THREE from 'three';
import { t } from '../core/i18n';
import { NPC_HOME, QUESTS, currentQuest, questReady, type GameState, type NpcId } from '../game/state';
import type { ResourceId } from '../game/planets';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export const RES_ICON: Record<ResourceId, string> = { crystal: '💎', ice: '🧊', fruit: '⭐' };

export type Device = 'keyboard' | 'gamepad';

/** A key cap for the keyboard, or a coloured face button for the gamepad. */
export function keyCap(kb: string, pad: string, device: Device): string {
  if (device === 'gamepad') {
    const cls = ['A', 'B', 'X', 'Y'].includes(pad) ? `pad ${pad}` : 'pad';
    return `<span class="key ${cls}">${pad}</span>`;
  }
  return `<span class="key">${kb}</span>`;
}

export interface Marker {
  pos: THREE.Vector3;
  label: string;
  sub?: string;
  color: string;
  target?: boolean;
}

const _v = new THREE.Vector3();

export class Hud {
  private readonly root = $('hud');
  private readonly markersEl = $('markers');
  private readonly markerPool: HTMLDivElement[] = [];
  private toastTimer = 0;
  private lastInv = '';
  private lastTracker = '';
  private lastControls = '';

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  toast(text: string, secs = 2.5): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('on');
    this.toastTimer = secs;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.remove('on');
    }
  }

  inventory(s: GameState, bump?: ResourceId): void {
    const key = JSON.stringify(s.inv);
    if (key === this.lastInv && !bump) return;
    this.lastInv = key;
    $('inv').innerHTML = (Object.keys(RES_ICON) as ResourceId[])
      .map((r) => `<div class="pill${bump === r ? ' bump' : ''}" title="${t(r)}">${RES_ICON[r]} ${s.inv[r]}</div>`)
      .join('');
  }

  tracker(s: GameState): void {
    let html = '';
    const npcs = Object.keys(QUESTS) as NpcId[];
    for (const npc of npcs) {
      const q = currentQuest(s, npc);
      if (!q || !s.npc[npc].acc) continue;
      html += `<h4>${t(q.title)}</h4>`;
      for (const o of q.objectives(s)) {
        const done = o.have >= o.need;
        html += `<div class="obj${done ? ' done' : ''}">${o.icon} ${t(o.label)} ${o.need > 1 ? `${o.have}/${o.need}` : ''} ${done ? '✓' : ''}</div>`;
      }
      if (questReady(s, npc)) html += `<div class="obj ready">💬 ${npc === 'pip' ? t('oReturn') : `${t('boltName')} · ${t(NPC_HOME.bolt)}`}</div>`;
    }
    if (!html) {
      // nothing accepted: point at whoever has a job
      if (currentQuest(s, 'pip')) html = `<h4>${t('questNew')}</h4><div class="obj">💬 ${t('talkToPip')}</div>`;
      else if (currentQuest(s, 'bolt') && s.visited.includes('bloom')) html = `<h4>${t('questNew')}</h4><div class="obj">💬 ${t('talkToBolt')}</div>`;
      else if (!currentQuest(s, 'bolt')) html = `<h4>★</h4><div class="obj">${t('allQuestsDone')}</div>`;
      else html = `<h4>${t('questNew')}</h4><div class="obj">💬 ${t('talkToBolt')}</div>`;
    }
    if (html === this.lastTracker) return;
    this.lastTracker = html;
    $('tracker').innerHTML = html;
  }

  /** The air meter on hostile planets (null hides it). */
  air(frac: number | null): void {
    const el = $('air');
    el.classList.toggle('on', frac !== null);
    if (frac === null) return;
    el.classList.toggle('low', frac < 0.3);
    $('air-fill').style.width = `${Math.round(frac * 100)}%`;
    $('air-l').textContent = `🫧 ${t('air')}`;
  }

  /** Race clock and ring count (null hides it). */
  race(text: string | null): void {
    const el = $('race');
    el.classList.toggle('on', !!text);
    if (text && el.innerHTML !== text) el.innerHTML = text;
  }

  /** A small status pill under the tracker (shelter, slippery ice). */
  status(text: string | null): void {
    const el = $('status');
    el.classList.toggle('on', !!text);
    // a leading "!" marks a warning
    const warn = !!text && text.startsWith('!');
    el.classList.toggle('warn', warn);
    const shown = warn ? text!.slice(1) : text;
    if (shown && el.textContent !== shown) el.textContent = shown;
  }

  flight(on: boolean, speed = 0, boost = 0, alt: number | null = null, target = '', auto = false): void {
    $('flight').classList.toggle('on', on);
    if (!on) return;
    $('fl-speed-l').textContent = t('speed');
    $('fl-boost-l').textContent = t('boost');
    $('fl-alt-l').textContent = t('height');
    $('fl-speed').style.width = `${Math.round(speed * 100)}%`;
    $('fl-boost').style.width = `${Math.round(boost * 100)}%`;
    $('fl-alt-row').style.display = alt === null ? 'none' : 'flex';
    if (alt !== null) $('fl-alt').textContent = `${Math.round(alt)} m`;
    $('fl-target').innerHTML = target;
    $('fl-auto').textContent = auto ? `▶ ${t('autopilotOn')}` : '';
  }

  jet(on: boolean, fuel = 1): void {
    $('jet').classList.toggle('on', on);
    if (on) $('jet-fuel').style.width = `${Math.round(fuel * 100)}%`;
  }

  prompt(html: string | null): void {
    const el = $('prompt');
    el.classList.toggle('on', !!html);
    if (html && el.innerHTML !== html) el.innerHTML = html;
  }

  controls(rows: [string, string][]): void {
    const html = rows.map(([k, l]) => `<div>${k} ${l}</div>`).join('');
    if (html === this.lastControls) return;
    this.lastControls = html;
    $('controls').innerHTML = html;
  }

  reticle(on: boolean): void {
    $('reticle').classList.toggle('on', on);
  }

  scanRing(camera: THREE.Camera, pos: THREE.Vector3 | null, progress = 0, name = '', known = false): void {
    const el = $('scanring');
    if (!pos) {
      el.classList.remove('on');
      return;
    }
    _v.copy(pos).project(camera);
    if (_v.z > 1) {
      el.classList.remove('on');
      return;
    }
    el.classList.add('on');
    el.classList.toggle('known', known);
    el.style.left = `${((_v.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - _v.y) / 2) * window.innerHeight}px`;
    (el.querySelector('.fg') as SVGCircleElement).style.strokeDashoffset = String(251.3 * (1 - progress));
    const n = el.querySelector('.name') as HTMLElement;
    if (n.textContent !== name) n.textContent = name;
  }

  markers(camera: THREE.PerspectiveCamera, list: Marker[]): void {
    while (this.markerPool.length < list.length) {
      const d = document.createElement('div');
      d.className = 'marker';
      d.innerHTML = '<div class="dot"></div><span></span><small></small>';
      this.markersEl.appendChild(d);
      this.markerPool.push(d);
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < this.markerPool.length; i++) {
      const el = this.markerPool[i];
      const m = list[i];
      if (!m) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      _v.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = _v.z > 0;
      _v.applyMatrix4(camera.projectionMatrix);
      let x = (_v.x + 1) / 2;
      let y = (1 - _v.y) / 2;
      if (behind) {
        x = 1 - x;
        y = 1 - y;
      }
      const off = behind || x < 0.04 || x > 0.96 || y < 0.06 || y > 0.94;
      if (off) {
        // clamp to the screen edge in the marker's direction
        let dx = x - 0.5;
        let dy = y - 0.5;
        if (behind && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dy = 0.5;
        const s = 0.44 / Math.max(Math.abs(dx), Math.abs(dy) * (w / h) * (h / w) * 1.0, 1e-4);
        dx *= s;
        dy *= s;
        // keep clear of the panels at the top and bottom of the screen
        x = 0.5 + Math.max(-0.45, Math.min(0.45, dx));
        y = 0.5 + Math.max(-0.36, Math.min(0.24, dy));
      }
      el.className = `marker${m.target ? ' target' : ''}${off ? ' edge' : ''}`;
      el.style.left = `${x * w}px`;
      el.style.top = `${y * h}px`;
      (el.firstChild as HTMLElement).style.background = m.color;
      (el.children[1] as HTMLElement).textContent = m.label;
      (el.children[2] as HTMLElement).textContent = m.sub ?? '';
    }
  }
}
