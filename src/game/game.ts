import * as THREE from 'three';
import { couch, mountBackButton } from '../couch';
import { setHum, setMusic, setMusicOn, sfx, unlockAudio, type MusicArea } from '../core/audio';
import { getLang, onLangChange, setLang, t, type Lang } from '../core/i18n';
import { Input } from '../core/input';
import { clamp, dampFactor, rand } from '../core/math';
import { COLORS } from '../core/palette';
import { say, setVoice, stopVoice, voiceOn } from '../core/voice';
import { Hud, keyCap, RES_ICON, type Marker } from '../ui/hud';
import { itemName, renderCraft, renderLog, type LogTab } from '../ui/menus';
import { thumbnails } from '../ui/thumbs';
import { Bean, CHAR_HEIGHT } from './models';
import { HOSTILE, PLANETS, SPECIES, STORM_RADIUS, SUN_RADIUS, planetById, type PlanetDef, type PlanetId, type ResourceId } from './planets';
import { Race, RING_R } from './race';
import { AIR_FLIGHT, SPACE_FLIGHT, Ship, type FlightParams } from './ship';
import { Space } from './space';
import { CEILING, FLY_RADIUS, Surface, WALK_RADIUS, type ResourceNode, type Scannable } from './surface';
import {
  NPC_HOME,
  PAINT_COLORS,
  QUESTS,
  RACE_MEDALS,
  RECIPES,
  clearState,
  craft,
  currentQuest,
  owns,
  questActive,
  type NpcId,
  type HatId,
  type PaintId,
  loadSetting,
  loadState,
  newState,
  questReady,
  saveSetting,
  saveState,
  type GameState,
} from './state';

type Mode = 'title' | 'space' | 'air' | 'foot';
type Overlay = 'title' | 'pause' | 'log' | 'dialog' | 'options' | 'craft' | null;
type Quality = 'high' | 'medium' | 'low';
const OVERLAYS = ['title', 'pause', 'log', 'dialog', 'options', 'craft'];
const SENS = [0.5, 0.75, 1, 1.4, 2];
/** Seconds of air on hostile planets (without / with the air suit). */
const AIR_SECS = [75, 150];

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Ship centre height above the ground when standing on its legs. */
const LAND_H = 1.75;
const BEAN_SCALE = 1.4;
const PAD_TOP = 0.37;

interface Fade {
  t: number;
  dur: number;
  mid: () => void;
  fired: boolean;
}

interface AutoLand {
  x: number;
  z: number;
  y: number;
  phase: 'move' | 'down';
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 30000);
  readonly input: Input;
  readonly hud = new Hud();
  readonly space = new Space();
  surface: Surface | null = null;
  readonly ship = new Ship();
  readonly bean = new Bean(COLORS.sky, { helmet: true });
  state: GameState = newState();
  mode: Mode = 'title';
  overlay: Overlay = 'title';
  private time = 0;
  private last = performance.now();
  autopilot = false;
  private autoLand: AutoLand | null = null;
  private takeoff = 0;
  private hyper: { t: number; to: PlanetId } | null = null;
  private fade: Fade | null = null;
  private readonly camQuat = new THREE.Quaternion();
  private readonly camLag = new THREE.Vector3();
  private readonly prevVel = new THREE.Vector3();
  private shake = 0;
  // on foot
  readonly player = { pos: new THREE.Vector3(), vy: 0, vx: 0, vz: 0, onGround: true, jetFuel: 1, jetting: false };
  footYaw = 0;
  footPitch = 0.35;
  private scanTarget: Scannable | null = null;
  private scanProgress = 0;
  private scanTick = 0;
  private readonly beam: THREE.Mesh;
  private saveTimer = 0;
  private stormCooldown = 0;
  private edgeCooldown = 0;
  private npcReady: Record<NpcId, boolean> = { pip: false, bolt: false };
  private logTab: LogTab = 'quests';
  private titleAngle = 0;
  readonly race = new Race();
  private readonly racePrev = new THREE.Vector3();
  private raceMsg = 0;
  private bumpCooldown = 0;
  raceAuto = false;
  /** Air left on hostile planets, 0..1. */
  air = 1;
  private airWarned = false;
  private sensorProgress = 0;
  private stormPhase = '';
  private landCam = 0;
  private cine = 0;
  private optionsFrom: Overlay = 'title';
  private quality: Quality = 'high';
  private musicOn = true;
  private spaceParams: FlightParams = SPACE_FLIGHT;
  private airParams: FlightParams = AIR_FLIGHT;
  /** Simulation steps per rendered frame (1 in play; tests raise it). */
  substeps = 1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
    this.bean.group.scale.setScalar(BEAN_SCALE);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4cfcd2, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.beam.visible = false;
    this.space.scene.add(this.ship.root, this.race.group);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.overlay && this.mode !== 'title') this.input.requestPointerLock();
    });
    const unlock = (): void => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // settings: language and read-aloud
    const lang = (loadSetting('lang') as Lang | null) ?? (couch ? (couch.lang as Lang) : /^(nb|nn|no)/i.test(navigator.language) ? 'no' : 'en');
    setLang(lang === 'no' ? 'no' : 'en');
    const v = loadSetting('voice');
    setVoice(v === null ? !!couch : v === '1');
    this.input.invertY = loadSetting('invert') === '1';
    this.input.mouseSens = Number(loadSetting('mouse')) || 1;
    this.input.stickSens = Number(loadSetting('stick')) || 1;
    const q = loadSetting('quality');
    this.quality = q === 'medium' || q === 'low' ? q : 'high';
    this.musicOn = loadSetting('music') !== '0';
    setMusicOn(this.musicOn);
    this.applyQuality();
    onLangChange(() => this.refreshTexts());
    this.wireMenus();
    this.refreshTexts();
    mountBackButton();
    this.titleCamera(0);
    (window as unknown as { __sh: unknown }).__sh = this.testApi();
    requestAnimationFrame(() => this.frame());
  }

  private applyQuality(): void {
    const q = this.quality;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : q === 'medium' ? 1 : 0.75);
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      // materials must recompile with or without shadow code
      for (const sc of [this.space.scene, this.surface?.scene]) {
        sc?.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
        });
      }
    }
    if (this.surface) {
      const sun = this.surface.sun;
      sun.castShadow = shadows;
      const size = q === 'high' ? 1024 : 512;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.setScalar(size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    }
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.surface?.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  // ================================================================== menus

  private wireMenus(): void {
    $('t-continue').addEventListener('click', () => this.continueGame());
    $('t-new').addEventListener('click', () => {
      if (loadState()) {
        $('t-confirm').classList.add('on');
        this.focusFirst($('t-cancel'));
      } else this.newGame();
    });
    $('t-yes').addEventListener('click', () => {
      $('t-confirm').classList.remove('on');
      this.newGame();
    });
    $('t-cancel').addEventListener('click', () => {
      $('t-confirm').classList.remove('on');
      this.focusFirst();
    });
    for (const id of ['t', 'p']) {
      $(`${id}-en`).addEventListener('click', () => this.setLanguage('en'));
      $(`${id}-no`).addEventListener('click', () => this.setLanguage('no'));
      $(`${id}-voice`).addEventListener('click', () => this.toggleVoice());
    }
    $('p-resume').addEventListener('click', () => this.closeOverlay());
    $('p-log').addEventListener('click', () => this.openLog());
    $('p-quit').addEventListener('click', () => {
      this.save();
      this.toTitle();
    });
    $('log-close').addEventListener('click', () => this.closeOverlay());
    $('t-options').addEventListener('click', () => this.openOptions('title'));
    $('p-options').addEventListener('click', () => this.openOptions('pause'));
    $('o-back').addEventListener('click', () => this.closeOptions());
    $('o-invert').addEventListener('click', () => {
      this.input.invertY = !this.input.invertY;
      saveSetting('invert', this.input.invertY ? '1' : '0');
      this.refreshTexts();
    });
    const cycle = (v: number): number => SENS[(SENS.indexOf(v) + 1) % SENS.length] ?? 1;
    $('o-mouse').addEventListener('click', () => {
      this.input.mouseSens = cycle(this.input.mouseSens);
      saveSetting('mouse', String(this.input.mouseSens));
      this.refreshTexts();
    });
    $('o-stick').addEventListener('click', () => {
      this.input.stickSens = cycle(this.input.stickSens);
      saveSetting('stick', String(this.input.stickSens));
      this.refreshTexts();
    });
    $('o-quality').addEventListener('click', () => {
      this.quality = this.quality === 'high' ? 'medium' : this.quality === 'medium' ? 'low' : 'high';
      saveSetting('quality', this.quality);
      this.applyQuality();
      this.refreshTexts();
    });
    $('o-music').addEventListener('click', () => {
      this.musicOn = !this.musicOn;
      saveSetting('music', this.musicOn ? '1' : '0');
      setMusicOn(this.musicOn);
      this.refreshTexts();
    });
    $('c-close').addEventListener('click', () => this.closeOverlay());
    $('c-body').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-item]');
      if (b) this.useItem(b.dataset.item!);
    });
    document.querySelectorAll<HTMLButtonElement>('#log .tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.logTab = b.dataset.tab as LogTab;
        this.renderLogPanel();
      }),
    );
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sfx.click()));
  }

  private setLanguage(l: Lang): void {
    setLang(l);
    saveSetting('lang', l);
  }

  private toggleVoice(): void {
    setVoice(!voiceOn());
    saveSetting('voice', voiceOn() ? '1' : '0');
    this.refreshTexts();
    if (voiceOn()) say(t('voiceOn'));
  }

  private refreshTexts(): void {
    $('t-tag').textContent = t('tagline');
    $('t-continue').textContent = t('continue');
    $('t-new').textContent = t('newGame');
    $('t-confirm-text').textContent = t('confirmNew');
    $('t-yes').textContent = t('yesNew');
    $('t-cancel').textContent = t('no');
    $('p-title').textContent = t('paused');
    $('p-resume').textContent = t('resume');
    $('p-log').textContent = t('questLog');
    $('p-quit').textContent = t('quitTitle');
    $('log-close').textContent = t('close');
    $('t-options').textContent = `⚙ ${t('options')}`;
    $('p-options').textContent = `⚙ ${t('options')}`;
    $('o-title').textContent = t('options');
    $('o-back').textContent = t('back');
    $('o-invert').textContent = t('optInvert', { v: this.input.invertY ? t('on') : t('off') });
    const dots = (v: number): string => '●'.repeat(SENS.indexOf(v) + 1 || 3) + '○'.repeat(SENS.length - (SENS.indexOf(v) + 1 || 3));
    $('o-mouse').textContent = t('optMouse', { v: dots(this.input.mouseSens) });
    $('o-stick').textContent = t('optStick', { v: dots(this.input.stickSens) });
    $('o-quality').textContent = t('optQuality', { v: t(this.quality === 'high' ? 'qHigh' : this.quality === 'medium' ? 'qMedium' : 'qLow') });
    $('o-music').textContent = t('optMusic', { v: this.musicOn ? t('on') : t('off') });
    $('c-title').textContent = `🔧 ${t('benchTitle')}`;
    $('c-close').textContent = t('close');
    if (this.overlay === 'craft') this.renderCraftPanel();
    for (const id of ['t', 'p']) {
      $(`${id}-voice`).textContent = voiceOn() ? t('voiceOn') : t('voiceOff');
      $(`${id}-voice`).classList.toggle('on', voiceOn());
      $(`${id}-en`).classList.toggle('on', getLang() === 'en');
      $(`${id}-no`).classList.toggle('on', getLang() === 'no');
    }
    const tabs = document.querySelectorAll<HTMLButtonElement>('#log .tabs button');
    const names: Record<string, string> = { quests: t('tabQuests'), finds: t('tabFinds'), planets: t('tabPlanets'), gear: t('tabGear') };
    tabs.forEach((b) => (b.textContent = names[b.dataset.tab!]));
    ($('t-continue') as HTMLButtonElement).style.display = loadState() ? '' : 'none';
    if (this.overlay === 'log') this.renderLogPanel();
    this.hud.inventory(this.state);
    this.hud.tracker(this.state);
  }

  private showOverlay(o: Overlay): void {
    for (const id of OVERLAYS) $(id).classList.toggle('visible', id === o);
    this.overlay = o;
    if (o) {
      this.input.exitPointerLock();
      this.focusFirst();
    }
  }

  private closeOverlay(): void {
    if (this.mode === 'title') return;
    stopVoice();
    this.showOverlay(null);
  }

  private focusFirst(el?: HTMLElement): void {
    const target = el ?? this.menuButtons().find((b) => b.classList.contains('primary')) ?? this.menuButtons()[0];
    target?.focus();
  }

  private menuButtons(): HTMLButtonElement[] {
    if (!this.overlay) return [];
    const root = $(this.overlay);
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.offsetParent !== null && !b.disabled);
  }

  private menuInput(): void {
    const i = this.input;
    const list = this.menuButtons();
    const cur = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (d: number): void => {
      const n = list.length;
      if (!n) return;
      list[(cur < 0 ? 0 : cur + d + n) % n].focus();
    };
    if (i.pressed('menuUp') || i.pressed('menuLeft')) move(-1);
    if (i.pressed('menuDown') || i.pressed('menuRight')) move(1);
    // Enter on a focused button clicks natively; the gamepad's A needs a nudge
    if (i.pressed('confirm') && i.device === 'gamepad') (document.activeElement as HTMLButtonElement | null)?.click?.();
    if (i.pressed('back') && this.overlay === 'options') this.closeOptions();
    else if (i.pressed('back') && (this.overlay === 'log' || this.overlay === 'pause' || this.overlay === 'craft')) this.closeOverlay();
    else if (i.pressed('log') && this.overlay === 'log') this.closeOverlay();
  }

  private openLog(): void {
    this.showOverlay('log');
    this.renderLogPanel();
    this.focusFirst($('log-close'));
  }

  private openOptions(from: Overlay): void {
    this.optionsFrom = from;
    this.refreshTexts();
    this.showOverlay('options');
    this.focusFirst($('o-invert'));
  }

  private closeOptions(): void {
    this.showOverlay(this.optionsFrom);
    this.focusFirst(this.optionsFrom === 'title' ? $('t-options') : $('p-options'));
  }

  private openCraft(): void {
    this.hud.prompt(null);
    this.hud.scanRing(this.camera, null);
    this.showOverlay('craft');
    this.renderCraftPanel();
    this.focusFirst($('c-body').querySelector<HTMLButtonElement>('button') ?? undefined);
  }

  private renderCraftPanel(): void {
    const s = this.state;
    $('c-inv').innerHTML = `${RES_ICON.crystal} ${s.inv.crystal} &nbsp; ${RES_ICON.ice} ${s.inv.ice} &nbsp; ${RES_ICON.fruit} ${s.inv.fruit}`;
    $('c-body').innerHTML = renderCraft(s, (id) => '#' + PAINT_COLORS[id as PaintId].toString(16).padStart(6, '0'));
  }

  /** Workbench button: equip what you have, or make it if you can. */
  useItem(key: string): boolean {
    const s = this.state;
    const [kind, id] = key.split(':') as ['upgrade' | 'paint' | 'hat', string];
    let ok = false;
    if (owns(s, kind, id)) {
      if (kind === 'paint') s.paint = id as PaintId;
      if (kind === 'hat') s.hat = id as HatId;
      ok = kind !== 'upgrade';
      if (ok) sfx.pickup();
    } else {
      const r = RECIPES.find((x) => x.kind === kind && x.id === id);
      if (r && craft(s, r)) {
        ok = true;
        sfx.craft();
        const msg = t('crafted', { x: itemName(r) });
        this.hud.toast(msg, 2.5);
        say(msg);
      } else sfx.deny();
    }
    this.applyGear();
    this.hud.inventory(s);
    this.save();
    this.renderCraftPanel();
    $('c-body').querySelector<HTMLButtonElement>(`button[data-item="${key}"]`)?.focus();
    return ok;
  }

  /** Paint, hat and the flight numbers from upgrades. */
  private applyGear(): void {
    const s = this.state;
    const paint = this.ship.model.paint;
    paint.color.setHex(PAINT_COLORS[s.paint] ?? PAINT_COLORS.coral);
    paint.emissive.setHex(s.paint === 'gold' ? 0x403000 : 0x000000);
    this.bean.setHat(s.hat);
    const tune = (b: FlightParams): FlightParams => ({
      ...b,
      boostSpeed: b.boostSpeed * (s.upgrades.includes('boost') ? 1.2 : 1),
      boostDrain: b.boostDrain * (s.upgrades.includes('boost') ? 0.8 : 1),
      energy: b.energy * (s.upgrades.includes('tank') ? 1.6 : 1),
    });
    this.spaceParams = tune(SPACE_FLIGHT);
    this.airParams = tune(AIR_FLIGHT);
    this.ship.params = this.surface ? this.airParams : this.spaceParams;
  }

  private renderLogPanel(): void {
    $('log-body').innerHTML = renderLog(this.state, this.logTab, this.logTab === 'finds' ? thumbnails(this.renderer) : {});
    document.querySelectorAll<HTMLButtonElement>('#log .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.logTab));
  }

  private dialog(text: string, extra: string, buttons: { label: string; action: () => void }[], npc: NpcId = 'pip'): void {
    $('dlg-who').textContent = t(`${npc}Name`);
    $('dialog').classList.toggle('bolt', npc === 'bolt');
    $('dlg-text').textContent = text;
    $('dlg-extra').innerHTML = extra;
    const box = $('dlg-buttons');
    box.innerHTML = '';
    buttons.forEach((b, i) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (i === 0) el.className = 'primary';
      el.addEventListener('click', () => {
        sfx.click();
        b.action();
      });
      box.appendChild(el);
    });
    this.showOverlay('dialog');
    say(text, { pitch: npc === 'bolt' ? 0.9 : 1.25 });
  }

  // ================================================================== game flow

  private newGame(): void {
    clearState();
    this.state = newState();
    this.startPlaying();
    this.enterSurface('pebble', 'landed');
    // stand facing Pip
    this.player.pos.set(3, 0, 9);
    this.player.pos.y = this.surface!.height(3, 9);
    this.footYaw = Math.atan2(this.surface!.pipPos.x - 3, this.surface!.pipPos.z - 9);
    this.save();
    this.hud.toast(t('talkToPip'), 4);
    say(t('talkToPip'));
  }

  private continueGame(): void {
    const s = loadState();
    if (!s) return this.newGame();
    this.state = s;
    this.startPlaying();
    if (s.where === 'space') this.enterSpace(null);
    else this.enterSurface(s.where, 'landed');
  }

  private startPlaying(): void {
    this.showOverlay(null);
    this.hud.show(true);
    this.autopilot = false;
    this.autoLand = null;
    this.hyper = null;
    this.takeoff = 0;
    this.race.reset();
    this.air = 1;
    for (const n of Object.keys(this.npcReady) as NpcId[]) this.npcReady[n] = questReady(this.state, n);
    this.applyGear();
    this.hud.inventory(this.state);
    this.hud.tracker(this.state);
  }

  private toTitle(): void {
    this.mode = 'title';
    this.leaveSurface();
    this.space.scene.add(this.ship.root);
    this.hud.show(false);
    this.hud.race(null);
    this.hud.air(null);
    this.hud.status(null);
    setHum(0, false);
    this.refreshTexts();
    this.showOverlay('title');
  }

  save(): void {
    const s = this.state;
    if (this.mode === 'space') {
      s.where = 'space';
      s.shipPos = [this.ship.pos.x, this.ship.pos.y, this.ship.pos.z];
      s.shipQuat = [this.ship.quat.x, this.ship.quat.y, this.ship.quat.z, this.ship.quat.w];
    } else if (this.surface && (this.mode === 'foot' || this.mode === 'air')) {
      s.where = this.surface.def.id;
      s.land = [this.ship.pos.x, this.ship.pos.z];
    }
    saveState(s);
  }

  private leaveSurface(): void {
    if (this.surface) {
      this.surface.dispose();
      this.surface = null;
    }
    this.bean.group.removeFromParent();
    this.beam.removeFromParent();
  }

  private enterSpace(from: PlanetDef | null): void {
    this.leaveSurface();
    this.mode = 'space';
    this.ship.params = this.spaceParams;
    this.ship.energy = Math.min(this.ship.energy, this.spaceParams.energy);
    this.hud.air(null);
    this.hud.status(null);
    this.ship.landed = false;
    this.space.scene.add(this.ship.root);
    this.camera.far = 30000;
    this.camera.updateProjectionMatrix();
    if (from) {
      const target = planetById(this.state.target);
      const dir = target.id !== from.id ? _v.subVectors(target.pos, from.pos).normalize() : _v.copy(from.pos).negate().normalize();
      dir.addScaledVector(UP, 0.15).normalize();
      const p = from.pos.clone().addScaledVector(dir, from.radius * 1.5);
      this.ship.placeAt(p, p.clone().add(dir), 80);
    } else {
      const s = this.state;
      this.ship.pos.set(...s.shipPos);
      this.ship.quat.set(...s.shipQuat);
      this.ship.vel.set(0, 0, 0);
      this.ship.forward(this.ship.vel).multiplyScalar(30);
      this.ship.controls.throttle = 0.2;
    }
    this.camQuat.copy(this.ship.quat);
    this.camLag.set(0, 0, 0);
    this.prevVel.copy(this.ship.vel);
    this.state.where = 'space';
    this.save();
  }

  private enterSurface(id: PlanetId, how: 'fly' | 'landed'): void {
    this.leaveSurface();
    const def = planetById(id);
    const s = this.state;
    if (this.race.running) this.race.reset();
    this.hud.race(null);
    const surf = new Surface(def, {
      probe: questActive(s, 'p3') && !s.probe,
      gears: questActive(s, 'b4') ? s.gears : null,
      sensors: s.sensors,
      shadows: this.quality !== 'low',
      shadowSize: this.quality === 'high' ? 1024 : 512,
    });
    this.air = 1;
    this.stormPhase = '';
    this.surface = surf;
    surf.scene.add(this.ship.root, this.beam);
    surf.fx.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
    this.camera.far = 1500;
    this.camera.updateProjectionMatrix();
    this.ship.params = this.airParams;
    if (!s.visited.includes(id)) s.visited.push(id);
    s.where = id;
    if (how === 'fly') {
      const a = Math.atan2(this.ship.pos.z - def.pos.z, this.ship.pos.x - def.pos.x);
      const p = new THREE.Vector3(Math.cos(a) * 140, 120, Math.sin(a) * 140);
      this.ship.landed = false;
      this.ship.placeAt(p, new THREE.Vector3(0, 70, 0), 40);
      this.camQuat.copy(this.ship.quat);
      this.mode = 'air';
    } else {
      let [x, z] = s.land;
      if (Math.hypot(x, z) > WALK_RADIUS - 10) [x, z] = [0, 0];
      const spot = this.clearSpot(x, z);
      this.ship.pos.set(spot.x, spot.y, spot.z);
      this.ship.quat.setFromAxisAngle(UP, 0.6);
      this.ship.vel.set(0, 0, 0);
      this.ship.angVel.set(0, 0, 0);
      this.ship.landed = true;
      this.ship.syncTransform();
      this.landed(false);
    }
  }

  /** A landing spot near (x, z) that is not inside a rock or tree. */
  private clearSpot(x: number, z: number): THREE.Vector3 {
    const surf = this.surface!;
    const onPad = Math.hypot(x, z) < 9;
    if (onPad) return new THREE.Vector3(0, PAD_TOP + LAND_H, 0);
    const p = new THREE.Vector3(x, 0, z);
    for (let k = 0; k < 4; k++) {
      p.y = -100;
      surf.collide(p, 3.5, 1000);
    }
    p.y = surf.height(p.x, p.z) + LAND_H;
    return p;
  }

  // ================================================================== main loop

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.input.poll();
    if (this.input.anyKeyPressed) unlockAudio();
    // tests may run the simulation faster than real time (several steps per rendered frame)
    for (let k = 0; k < this.substeps; k++) {
      this.step(dt, k === this.substeps - 1);
      this.input.endFrame();
    }
  }

  step(dt: number, render = true): void {
    const i = this.input;
    if (this.mode === 'title') {
      setMusic('title');
      this.menuInput();
      this.titleCamera(dt);
      this.space.update(dt, this.time, this.camera);
      if (render) this.renderer.render(this.space.scene, this.camera);
      return;
    }
    if (i.pressed('voice')) this.toggleVoice();
    if (this.overlay) {
      const was = this.overlay;
      this.menuInput();
      if (i.pressed('pause') && was === 'pause' && this.overlay === 'pause') this.closeOverlay();
    } else {
      if (i.pressed('pause')) {
        this.showOverlay('pause');
      } else if (i.pressed('log') || (this.mode === 'foot' && i.pressed('target'))) {
        this.openLog();
      } else {
        this.updateFade(dt);
        if (this.mode === 'space') this.updateSpace(dt);
        else if (this.mode === 'air') this.updateAir(dt);
        else if (this.mode === 'foot') this.updateFoot(dt);
        this.checkQuest();
        this.saveTimer += dt;
        if (this.saveTimer > 5 && !this.fade) {
          this.saveTimer = 0;
          this.save();
        }
      }
    }
    this.hud.update(dt);
    this.updateHud();
    const scene = this.surface ? this.surface.scene : this.space.scene;
    if (this.surface) {
      const focus = this.mode === 'foot' ? this.player.pos : this.ship.pos;
      const res = this.surface.update(this.overlay ? 0 : dt, this.time, this.player.pos, focus, this.camera);
      if (res.geyserLaunch && this.mode === 'foot' && !this.overlay) {
        if (this.sensorProgress > 0) {
          this.sensorProgress = 0;
          this.hud.toast(t('sensorBlown'), 2.5);
          say(t('sensorBlown'));
        }
        this.player.vy = 22;
        this.player.onGround = false;
        this.bean.squash(1.4);
        sfx.geyser();
      }
    } else this.space.update(dt, this.time, this.camera);
    const area: MusicArea = this.race.running ? 'race' : this.surface ? this.surface.def.id : 'space';
    setMusic(area);
    if (render) this.renderer.render(scene, this.camera);
  }

  private titleCamera(dt: number): void {
    this.titleAngle += dt * 0.06;
    const p = planetById('pebble');
    const r = p.radius * 3.2;
    this.camera.position.set(p.pos.x + Math.cos(this.titleAngle) * r, p.pos.y + 120 + Math.sin(this.titleAngle * 0.7) * 60, p.pos.z + Math.sin(this.titleAngle) * r);
    this.camera.lookAt(_v.copy(p.pos).add(_v2.set(-200, 0, 0)));
    this.ship.root.position.set(p.pos.x + Math.cos(this.titleAngle + 0.25) * r * 0.85, p.pos.y + 90, p.pos.z + Math.sin(this.titleAngle + 0.25) * r * 0.85);
    this.ship.root.lookAt(p.pos.x + Math.cos(this.titleAngle + 0.4) * r * 0.85, p.pos.y + 90, p.pos.z + Math.sin(this.titleAngle + 0.4) * r * 0.85);
    this.ship.root.rotateY(Math.PI);
    this.ship.model.body.rotation.z = -0.3;
  }

  private startFade(text: string, mid: () => void, dur = 1.8, color = '#ffffff'): void {
    if (this.fade) return;
    $('fade').style.background = color;
    $('fade-text').textContent = text;
    this.fade = { t: 0, dur, mid, fired: false };
    if (text) say(text);
  }

  private updateFade(dt: number): void {
    const f = this.fade;
    if (!f) return;
    f.t += dt;
    if (!f.fired && f.t >= f.dur * 0.45) {
      f.fired = true;
      f.mid();
    }
    const a = clamp(Math.min(f.t / (f.dur * 0.35), (f.dur - f.t) / (f.dur * 0.4)), 0, 1);
    $('fade').style.opacity = String(a);
    if (f.t >= f.dur) {
      this.fade = null;
      $('fade').style.opacity = '0';
    }
  }

  // ================================================================== flight

  /** Pilot input into ship controls (Tachyon's throttle handling). Returns true if the pilot touched the stick. */
  private pilot(dt: number): boolean {
    const f = this.input.readFlight();
    const c = this.ship.controls;
    const manual = Math.abs(f.pitch) > 0.2 || Math.abs(f.yaw) > 0.2 || Math.abs(f.roll) > 0.3 || f.slide;
    if (this.autopilot && manual) {
      this.autopilot = false;
    }
    c.pitch = f.pitch;
    c.yaw = f.yaw;
    c.roll = f.roll;
    c.strafeX = f.strafeX;
    c.strafeY = f.strafeY;
    c.boost = f.boost;
    c.slide = f.slide;
    c.throttle = clamp(c.throttle + f.throttleDelta * dt * 0.8, -0.25, 1);
    return manual;
  }

  /** Points the nose along a world direction (autopilot), keeping the wings level. */
  private steer(dir: THREE.Vector3, gain = 2.5): number {
    const s = this.ship;
    _qi.copy(s.quat).invert();
    const local = _v3.copy(dir).normalize().applyQuaternion(_qi);
    let yaw = clamp(local.x * gain, -1, 1);
    const pitch = clamp(local.y * gain, -1, 1);
    if (local.z > 0) yaw = local.x >= 0 ? 1 : -1;
    s.controls.yaw = yaw;
    s.controls.pitch = pitch;
    s.right(_v2);
    s.controls.roll = clamp(_v2.y * 2, -1, 1);
    return -local.z; // 1 when lined up
  }

  private levelWings(): void {
    this.ship.right(_v2);
    if (Math.abs(this.ship.controls.roll) < 0.1) this.ship.controls.roll = clamp(_v2.y * 1.6, -1, 1);
  }

  private updateSpace(dt: number): void {
    const s = this.ship;
    const i = this.input;
    if (i.pressed('target')) this.cycleTarget();
    if (i.pressed('autopilot')) this.setAutopilot(!this.autopilot);
    if (i.pressed('hyper')) this.tryHyper();
    if (i.pressed('land')) this.hud.toast(t('tooHigh'));
    if (!this.hyper) this.pilot(dt);
    if (this.autopilot && !this.hyper) {
      const target = planetById(this.state.target);
      const to = _v.subVectors(target.pos, s.pos);
      const dist = to.length();
      const aligned = this.steer(to);
      const near = dist - target.radius;
      s.controls.throttle = near > 600 ? 1 : 0.7;
      s.controls.boost = near > 900 && aligned > 0.97;
      s.controls.slide = false;
    }
    if (this.hyper) {
      this.hyper.t += dt;
      s.controls.boost = false;
      this.shake = Math.max(this.shake, this.hyper.t * 0.6);
      if (this.hyper.t > 1.4) {
        const to = planetById(this.hyper.to);
        this.hyper = null;
        this.startFade(
          t(to.id),
          () => {
            const dir = _v.copy(to.pos).negate().normalize().addScaledVector(UP, 0.2).normalize();
            const p = to.pos.clone().addScaledVector(dir, to.radius * 2.2);
            s.placeAt(p, to.pos, 60);
            this.camQuat.copy(s.quat);
            this.prevVel.copy(s.vel);
          },
          1.4,
          '#e8f8ff',
        );
      }
    }
    if (this.raceAuto && !this.hyper) {
      const ring = this.race.rings[this.race.running ? this.race.next : 0];
      const to = _v.subVectors(ring.pos, s.pos);
      const aligned = this.steer(to, 3);
      s.controls.throttle = 1;
      s.controls.boost = aligned > 0.97 && to.length() > 120;
      s.controls.slide = false;
    }
    this.racePrev.copy(s.pos);
    s.updateFlight(dt);
    this.raceEvent(this.race.update(dt, this.racePrev, s.pos, s.vel));
    // the sun is too hot to touch
    const ds = s.pos.length();
    if (ds < SUN_RADIUS * 1.5) {
      s.pos.setLength(SUN_RADIUS * 1.5);
      s.vel.addScaledVector(_v.copy(s.pos).normalize(), 60);
    }
    // the storm
    if (this.stormCooldown > 0) this.stormCooldown -= dt;
    const dune = planetById('dune');
    const toDune = _v.subVectors(s.pos, dune.pos);
    if (!this.state.hyperdrive && toDune.length() < STORM_RADIUS) {
      toDune.setLength(STORM_RADIUS);
      s.pos.copy(dune.pos).add(toDune);
      const n = toDune.normalize();
      const vn = s.vel.dot(n);
      if (vn < 0) s.vel.addScaledVector(n, -vn * 1.6);
      this.shake = 1;
      if (this.stormCooldown <= 0) {
        this.stormCooldown = 3;
        this.hud.toast(t('storm'), 3);
        say(t('storm'));
        sfx.deny();
      }
      if (this.autopilot) this.setAutopilot(false);
    }
    // enter an atmosphere
    if (!this.fade && !this.hyper) {
      for (const p of PLANETS) {
        if (s.pos.distanceTo(p.pos) < p.radius * 1.2) {
          if (this.state.target === p.id) this.autopilot = this.autopilot && true;
          else this.autopilot = false;
          sfx.whoosh();
          this.startFade(t('entering', { p: t(p.id) }), () => this.enterSurface(p.id, 'fly'), 2.0, '#' + p.atmosphere.toString(16).padStart(6, '0'));
          break;
        }
      }
    }
    s.updateVisuals(dt, this.time);
    setHum(0.3 + s.thrust * 0.7, s.boosting);
    this.chaseCamera(dt);
  }

  private raceEvent(ev: ReturnType<Race['update']>): void {
    if (this.bumpCooldown > 0) this.bumpCooldown -= 1 / 60;
    if (this.raceMsg > 0) this.raceMsg -= 1 / 60;
    const r = this.race;
    if (ev === 'start') {
      sfx.ring();
      this.hud.toast(t('raceStart'), 2);
      say(t('raceStart'));
    } else if (ev === 'ring') sfx.ring();
    else if (ev === 'bump' && this.bumpCooldown <= 0) {
      this.bumpCooldown = 1;
      sfx.bump();
      this.shake = 1.2;
      this.hud.toast(t('bump'), 1);
    } else if (ev === 'lost') {
      this.hud.toast(t('raceLost'), 3);
      sfx.deny();
    } else if (ev === 'finish') {
      const time = Math.round(r.time * 10) / 10;
      const st = this.state;
      if (st.raceBest === null || time < st.raceBest) st.raceBest = time;
      const medal = time <= RACE_MEDALS[0] ? 'medalGold' : time <= RACE_MEDALS[1] ? 'medalSilver' : time <= RACE_MEDALS[2] ? 'medalBronze' : null;
      const icon = medal === 'medalGold' ? '🥇' : medal === 'medalSilver' ? '🥈' : medal ? '🥉' : '🏁';
      const msg = medal ? `${icon} ${t(medal)} ${t('raceDone', { t: time.toFixed(1) })}` : t('raceSlow', { t: time.toFixed(1) });
      this.hud.toast(msg, 5);
      say(msg);
      if (medal) sfx.medal();
      else sfx.quest();
      this.raceMsg = 6;
      this.lastRace = `${icon} ${time.toFixed(1)} s<small>${t('best')} ${st.raceBest.toFixed(1)} s</small>`;
      this.save();
    }
  }

  private lastRace = '';

  private updateAir(dt: number): void {
    const s = this.ship;
    const surf = this.surface!;
    const i = this.input;
    if (i.pressed('target')) this.cycleTarget();
    if (i.pressed('autopilot') && !this.autoLand) this.setAutopilot(!this.autopilot);
    if (i.pressed('hyper')) this.hud.toast(t('flyUp'));
    if (this.takeoff > 0) {
      this.takeoff -= dt;
      s.pos.y += dt * 9;
      s.vel.set(0, 9, 0);
      s.angVel.set(0, 0, 0);
      s.thrust = 0.6;
      if (this.takeoff <= 0) {
        s.forward(s.vel).multiplyScalar(8);
        s.controls.throttle = 0.35;
      }
    } else if (this.autoLand) {
      this.updateAutoLand(dt);
    } else {
      const manual = this.pilot(dt);
      if (!manual) this.levelWings();
      if (i.pressed('land')) this.tryLand();
      if (this.autopilot) {
        if (this.state.target === surf.def.id) {
          // home to the landing pad and set down
          const to = _v.set(-s.pos.x, 0, -s.pos.z);
          const hd = to.length();
          const groundY = surf.height(s.pos.x, s.pos.z);
          const wantY = Math.max(groundY + 25, 35);
          to.y = (wantY - s.pos.y) * 1.5;
          this.steer(to, 2);
          s.controls.throttle = hd > 60 ? 1 : 0.45;
          s.controls.boost = hd > 120;
          if (hd < 24) this.startAutoLand(0, 0);
        } else {
          // climb out towards space
          s.forward(_v);
          _v.y = 0;
          if (_v.lengthSq() < 0.01) _v.set(0, 0, -1);
          _v.normalize().multiplyScalar(0.8).add(_v2.set(0, 0.75, 0));
          this.steer(_v, 2);
          s.controls.throttle = 1;
          s.controls.boost = true;
        }
      }
    }
    if (this.takeoff <= 0 && !this.autoLand) s.updateFlight(dt);
    if (surf.storm && surf.storm.amount > 0.05 && !this.autoLand && this.takeoff <= 0) s.vel.addScaledVector(surf.storm.wind, surf.storm.amount * 5 * dt);
    // terrain and props
    const g = surf.height(s.pos.x, s.pos.z);
    if (!this.autoLand && this.takeoff <= 0 && s.pos.y < g + 3) {
      s.pos.y = g + 3;
      if (s.vel.y < 0) s.vel.y *= -0.3;
    }
    if (!this.autoLand) surf.collide(s.pos, 2.6, 2);
    const r = Math.hypot(s.pos.x, s.pos.z);
    if (this.edgeCooldown > 0) this.edgeCooldown -= dt;
    if (r > FLY_RADIUS) {
      s.pos.x *= FLY_RADIUS / r;
      s.pos.z *= FLY_RADIUS / r;
      const n = _v.set(s.pos.x / FLY_RADIUS, 0, s.pos.z / FLY_RADIUS);
      const vn = s.vel.dot(n);
      if (vn > 0) s.vel.addScaledVector(n, -vn * 1.5);
      if (this.edgeCooldown <= 0) {
        this.edgeCooldown = 3;
        this.hud.toast(t('flyUp'));
      }
    }
    if (s.pos.y > CEILING && !this.fade) {
      sfx.whoosh();
      const from = surf.def;
      this.startFade(t('leaving'), () => this.enterSpace(from), 1.8, '#1a1440');
    }
    s.updateVisuals(dt, this.time);
    // dust under a low ship
    if (s.pos.y - g < 12 && Math.random() < dt * 14) {
      _v.set(s.pos.x + rand(-2, 2), g + 0.3, s.pos.z + rand(-2, 2));
      surf.fx.emit(_v, _v2.set(rand(-4, 4), rand(0.5, 2), rand(-4, 4)), this.surface!.def.ground[2], 1.8, 1.0, { grow: 1.5, drag: 1 });
    }
    setHum(this.autoLand?.phase === 'down' ? 0.35 : 0.3 + s.thrust * 0.6, s.boosting);
    this.chaseCamera(dt);
    // keep the camera above ground
    const cg = surf.height(this.camera.position.x, this.camera.position.z) + 1.5;
    if (this.camera.position.y < cg) this.camera.position.y = cg;
  }

  private tryLand(): void {
    const s = this.ship;
    const surf = this.surface!;
    const alt = s.pos.y - surf.height(s.pos.x, s.pos.z);
    if (alt > 70) {
      this.hud.toast(t('tooHigh'));
      sfx.deny();
      return;
    }
    if (Math.hypot(s.pos.x, s.pos.z) < 30) return this.startAutoLand(0, 0);
    // a little ahead of the ship, along its motion
    _v.copy(s.vel).setY(0).multiplyScalar(0.6).clampLength(0, 25);
    this.startAutoLand(s.pos.x + _v.x, s.pos.z + _v.z);
  }

  private startAutoLand(x: number, z: number): void {
    const spot = this.clearSpot(x, z);
    this.autoLand = { x: spot.x, z: spot.z, y: spot.y, phase: 'move' };
    this.landCam = 0;
    this.autopilot = false;
  }

  private updateAutoLand(dt: number): void {
    const s = this.ship;
    const L = this.autoLand!;
    s.forward(_v);
    const yaw = Math.atan2(-_v.x, -_v.z);
    _q.setFromAxisAngle(UP, yaw);
    s.quat.slerp(_q, dampFactor(3, dt));
    s.angVel.multiplyScalar(1 - dampFactor(4, dt));
    if (L.phase === 'move') {
      const dx = L.x - s.pos.x;
      const dz = L.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const sp = Math.min(28, d * 1.2 + 1);
      const k = dampFactor(3, dt);
      s.vel.x += ((dx / (d || 1)) * sp - s.vel.x) * k;
      s.vel.z += ((dz / (d || 1)) * sp - s.vel.z) * k;
      const groundHere = this.surface!.height(s.pos.x, s.pos.z);
      const wantY = Math.max(L.y + 6, groundHere + 6, Math.min(s.pos.y, L.y + 30));
      s.vel.y += ((wantY - s.pos.y) * 1.5 - s.vel.y) * k;
      s.pos.addScaledVector(s.vel, dt);
      s.thrust = 0.4;
      if (d < 0.6) L.phase = 'down';
    } else {
      s.vel.set(0, 0, 0);
      s.pos.x += (L.x - s.pos.x) * dampFactor(4, dt);
      s.pos.z += (L.z - s.pos.z) * dampFactor(4, dt);
      const dy = s.pos.y - L.y;
      s.pos.y -= Math.max(1.5, dy * 1.4) * dt;
      s.thrust = 0.3;
      this.landCam = Math.min(1, this.landCam + dt * 0.5);
      if (s.pos.y <= L.y + 0.02) {
        s.pos.y = L.y;
        s.quat.copy(_q);
        this.autoLand = null;
        this.landed(true);
      }
    }
  }

  /** The ship has set down: hop out. */
  private landed(withEffects: boolean): void {
    const s = this.ship;
    const surf = this.surface!;
    s.landed = true;
    s.vel.set(0, 0, 0);
    s.angVel.set(0, 0, 0);
    s.thrust = 0;
    s.syncTransform();
    s.updateVisuals(0.016, this.time);
    this.mode = 'foot';
    this.autopilot = false;
    setHum(0, false);
    s.right(_v);
    const p = this.player;
    // step out beside the wing, a little behind the cockpit
    p.pos.copy(s.pos).addScaledVector(_v, 5.5).addScaledVector(s.forward(_v2), -1.5);
    surf.collide(p.pos, 0.6, 1.6);
    p.pos.y = surf.groundAt(p.pos.x, p.pos.z, p.pos.y + 2);
    p.vy = 0;
    p.vx = p.vz = 0;
    p.onGround = true;
    p.jetFuel = 1;
    surf.scene.add(this.bean.group);
    this.bean.group.position.copy(p.pos);
    this.bean.squash(0.6);
    s.forward(_v);
    this.footYaw = Math.atan2(_v.x, _v.z);
    this.bean.targetYaw = this.bean.yaw = this.footYaw;
    this.footPitch = 0.35;
    if (!withEffects) this.camera.position.set(p.pos.x - Math.sin(this.footYaw) * 7, p.pos.y + 4.5, p.pos.z - Math.cos(this.footYaw) * 7);
    this.air = 1;
    this.airWarned = false;
    if (withEffects) {
      // the camera swoops from the landing view down behind the astronaut
      this.cine = 1.4;
      sfx.land();
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        _v.set(s.pos.x + Math.cos(a) * 2, s.pos.y - LAND_H + 0.3, s.pos.z + Math.sin(a) * 2);
        surf.fx.emit(_v, _v2.set(Math.cos(a) * 8, 1, Math.sin(a) * 8), surf.def.ground[2], 2, 1.0, { grow: 1.5, drag: 1.5 });
      }
      this.hud.toast(t(surf.def.id), 2.5);
    }
    this.state.land = [s.pos.x, s.pos.z];
    this.save();
  }

  private board(): void {
    const surf = this.surface!;
    this.bean.group.removeFromParent();
    this.beam.visible = false;
    this.mode = 'air';
    this.ship.landed = false;
    this.takeoff = 1.6;
    this.ship.energy = this.airParams.energy;
    this.air = 1;
    this.hud.air(null);
    this.hud.status(null);
    this.ship.controls.throttle = 0.3;
    this.camQuat.copy(this.ship.quat);
    sfx.whoosh();
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      _v.set(this.ship.pos.x, this.ship.pos.y - LAND_H + 0.3, this.ship.pos.z);
      surf.fx.emit(_v, _v2.set(Math.cos(a) * 9, 1, Math.sin(a) * 9), surf.def.ground[2], 2, 1.0, { grow: 1.5, drag: 1.5 });
    }
  }

  private setAutopilot(on: boolean): void {
    if (on && this.mode === 'space') {
      const target = planetById(this.state.target);
      if (target.locked && !this.state.hyperdrive) {
        this.hud.toast(t('locked'));
        sfx.deny();
        return;
      }
    }
    this.autopilot = on;
    this.hud.toast(on ? `▶ ${t('autopilotOn')}` : `■ ${t('autopilotOn')}`, 1.5);
  }

  private cycleTarget(): void {
    const ids = PLANETS.map((p) => p.id);
    const k = ids.indexOf(this.state.target);
    this.state.target = ids[(k + 1) % ids.length];
    this.hud.toast(`${t('target')}: ${t(this.state.target)}`, 1.5);
    sfx.click();
  }

  private tryHyper(): void {
    const s = this.state;
    if (this.hyper || this.fade) return;
    if (!s.hyperdrive) {
      this.hud.toast(t('hyperNeed'));
      sfx.deny();
      return;
    }
    const to = planetById(s.target);
    if (this.ship.pos.distanceTo(to.pos) < to.radius * 3) {
      this.hud.toast(t('hyperHere'));
      return;
    }
    if (s.inv.crystal < 1) {
      this.hud.toast(t('hyperNoCrystal'));
      sfx.deny();
      return;
    }
    s.inv.crystal -= 1;
    this.hud.inventory(s, 'crystal');
    this.hyper = { t: 0, to: to.id };
    this.autopilot = false;
    this.hud.toast(t('hyperCharging'), 1.5);
    sfx.whoosh();
  }

  /** Tachyon's chase camera: lags the nose, pushed back by acceleration, wider FOV at speed. */
  private chaseCamera(dt: number): void {
    const p = this.ship;
    if (this.takeoff > 0 || this.autoLand) this.camQuat.slerp(p.quat, dampFactor(3, dt));
    else this.camQuat.slerp(p.quat, dampFactor(p.sliding ? 6 : 9, dt));
    const off = _v.copy(p.model.cameraOffset);
    off.z += p.boosting ? 2.5 : 0;
    off.applyQuaternion(this.camQuat);
    this.camera.position.copy(p.pos).add(off);
    _v3.subVectors(p.vel, this.prevVel).divideScalar(Math.max(dt, 1e-3));
    this.prevVel.copy(p.vel);
    p.forward(_v2);
    const along = _v3.dot(_v2);
    _v3.addScaledVector(_v2, -along).multiplyScalar(-0.002).addScaledVector(_v2, -along * 0.009);
    if (_v3.length() > 2.2) _v3.setLength(2.2);
    this.camLag.lerp(_v3, dampFactor(3, dt));
    this.camera.position.add(this.camLag);
    if (p.boosting) this.shake = Math.max(this.shake, 0.22);
    this.camera.quaternion.copy(this.camQuat);
    // look a little above the ship so it sits in the lower third
    this.camera.rotateX(-0.08);
    // takeoff and landing: swing round to the side and look at the ship
    const swing = this.takeoff > 0 ? this.takeoff / 1.6 : this.autoLand?.phase === 'down' ? this.landCam : 0;
    if (swing > 0.001 && this.surface) {
      const e = swing * swing * (3 - 2 * swing);
      off.copy(p.model.cameraOffset).applyQuaternion(this.camQuat).applyAxisAngle(UP, e * 1.3);
      off.y += e * -1.2;
      this.camera.position.copy(p.pos).add(off);
      _q.copy(this.camera.quaternion);
      this.camera.lookAt(p.pos);
      this.camera.quaternion.slerp(_q, 1 - e);
    }
    if (this.shake > 0.001) {
      const sh = Math.min(this.shake, 2);
      this.camera.position.add(_v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sh * 0.3));
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    const speedFrac = p.speed / p.params.maxSpeed;
    const fov = 70 + clamp(speedFrac - 1, 0, 1) * 14 + (this.hyper ? this.hyper.t * 20 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * dampFactor(4, dt);
      this.camera.updateProjectionMatrix();
      this.surface?.fx.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
    }
  }

  // ================================================================== on foot

  private updateFoot(dt: number): void {
    const surf = this.surface!;
    const p = this.player;
    const s = this.state;
    const f = this.input.readFoot(dt);
    this.footYaw -= f.lookX;
    this.footPitch = clamp(this.footPitch + f.lookY, -0.25, 1.0);
    // move relative to the camera
    const fx = Math.sin(this.footYaw);
    const fz = Math.cos(this.footYaw);
    const speed = f.run ? 9.5 : 6;
    const wx = (fx * f.moveY - fz * f.moveX) * speed;
    const wz = (fz * f.moveY + fx * f.moveX) * speed;
    // slippery ice: you keep sliding and steer slowly
    const slip = p.onGround && surf.slippery(p.pos.x, p.pos.z);
    const k = dampFactor(p.onGround ? (slip ? 0.9 : 12) : 4, dt);
    p.vx += (wx * (slip ? 1.3 : 1) - p.vx) * k;
    p.vz += (wz - p.vz) * k;
    const grav = 24 * surf.def.gravity;
    if (this.input.pressed('jump') && p.onGround) {
      p.vy = 9.5;
      p.onGround = false;
      this.bean.squash(1.3);
      sfx.jump();
    }
    p.jetting = false;
    if (s.jetpack && !p.onGround && f.jumpHeld && p.jetFuel > 0 && p.vy < 7) {
      p.vy += 40 * dt;
      p.jetFuel = Math.max(0, p.jetFuel - dt / (s.upgrades.includes('superjet') ? 4.8 : 2.4));
      p.jetting = true;
      if (Math.random() < 0.6) {
        _v.copy(p.pos).add(_v2.set(-Math.sin(this.bean.yaw) * 0.6, 0.3, -Math.cos(this.bean.yaw) * 0.6));
        surf.fx.emit(_v, _v2.set(rand(-1, 1), -6, rand(-1, 1)), 0xffb347, 1.3, 0.5, { grow: 1 });
      }
    }
    p.vy -= grav * dt;
    p.pos.x += p.vx * dt;
    p.pos.z += p.vz * dt;
    p.pos.y += p.vy * dt;
    // sandstorm wind pushes you unless a mesa shelters you
    let status: string | null = slip ? `⛸ ${t('slippery')}` : null;
    if (surf.storm) {
      const st = surf.storm;
      if (st.phase !== this.stormPhase) {
        if (this.stormPhase) {
          const key = st.phase === 'warn' ? 'stormSoon' : st.phase === 'storm' ? 'sandstorm' : 'stormOver';
          this.hud.toast(t(key), 3.5);
          say(t(key));
          if (st.phase !== 'calm') sfx.wind();
        }
        this.stormPhase = st.phase;
      }
      if (st.amount > 0.3) {
        if (surf.sheltered(p.pos)) status = `🪨 ${t('sheltered')}`;
        else {
          p.pos.addScaledVector(st.wind, st.amount * 4.2 * dt);
          status = `🌪 ${t('sandstorm')}`;
        }
      }
    }
    this.hud.status(status);
    surf.collide(p.pos, 0.55, 1.6);
    // the ship stands in the way too
    const sh = this.ship.pos;
    const dsx = p.pos.x - sh.x;
    const dsz = p.pos.z - sh.z;
    const dsd = Math.hypot(dsx, dsz);
    if (dsd < 2.8 && p.pos.y < sh.y + 0.6) {
      p.pos.x = sh.x + (dsx / (dsd || 1)) * 2.8;
      p.pos.z = sh.z + (dsz / (dsd || 1)) * 2.8;
    }
    const r = Math.hypot(p.pos.x, p.pos.z);
    if (this.edgeCooldown > 0) this.edgeCooldown -= dt;
    if (r > WALK_RADIUS) {
      p.pos.x *= WALK_RADIUS / r;
      p.pos.z *= WALK_RADIUS / r;
      if (this.edgeCooldown <= 0) {
        this.edgeCooldown = 3;
        this.hud.toast(t('edge'));
      }
    }
    const ground = surf.groundAt(p.pos.x, p.pos.z, p.pos.y);
    const wasAir = !p.onGround;
    if (p.pos.y <= ground) {
      if (wasAir && p.vy < -6) this.bean.squash(0.7);
      p.pos.y = ground;
      p.vy = 0;
      p.onGround = true;
      p.jetFuel = Math.min(1, p.jetFuel + dt * 0.8);
    } else if (p.pos.y > ground + 0.15) p.onGround = false;
    else if (p.onGround) p.pos.y = ground; // stick to slopes walking down
    // model
    const hs = Math.hypot(p.vx, p.vz);
    if (hs > 0.5) this.bean.face(p.vx, p.vz);
    this.bean.group.position.copy(p.pos);
    this.bean.update(dt, clamp(hs / 6, 0, 1.4), p.onGround, p.vy, p.jetting);
    this.hud.jet(s.jetpack && (p.jetFuel < 0.999 || p.jetting), p.jetFuel);

    this.interact(dt, f.useHeld, f.scanHeld);
    this.updateAirMeter(dt);

    // Pip and Bolt turn to watch you
    for (const n of surf.npcs) {
      n.bean.face(p.pos.x - n.pos.x, p.pos.z - n.pos.z);
      if (n.id === 'pip') n.bean.update(dt, 0, true, 0);
      n.bean.pivot.position.y = Math.abs(Math.sin(this.time * 2 + (n.id === 'pip' ? 0 : 1))) * 0.05;
    }
    this.footCamera(dt);
  }

  /** Air on hostile planets: drains on foot, refills by the ship; running out is never game over. */
  private updateAirMeter(dt: number): void {
    const surf = this.surface!;
    const s = this.state;
    if (!HOSTILE.includes(surf.def.id)) {
      this.hud.air(null);
      return;
    }
    const p = this.player;
    const nearShip = Math.hypot(p.pos.x - this.ship.pos.x, p.pos.z - this.ship.pos.z) < 7;
    if (nearShip) this.air = Math.min(1, this.air + dt * 0.5);
    else this.air = Math.max(0, this.air - dt / AIR_SECS[s.upgrades.includes('suit') ? 1 : 0]);
    if (this.air < 0.3 && !this.airWarned) {
      this.airWarned = true;
      this.hud.toast(t('airLow'), 3);
      say(t('airLow'));
      sfx.lowAir();
    } else if (this.air > 0.5) this.airWarned = false;
    this.hud.air(this.air);
    if (this.air <= 0 && !this.fade) {
      sfx.deny();
      this.startFade(
        t('airOut'),
        () => {
          // back beside the ship, a little lighter
          const lost: string[] = [];
          for (const r of Object.keys(RES_ICON) as ResourceId[]) {
            if (s.inv[r] > 0) {
              s.inv[r] -= 1;
              lost.push(`1 ${RES_ICON[r]}`);
            }
          }
          this.ship.right(_v);
          p.pos.copy(this.ship.pos).addScaledVector(_v, 5.5);
          p.pos.y = surf.groundAt(p.pos.x, p.pos.z, p.pos.y + 4);
          p.vx = p.vy = p.vz = 0;
          this.air = 1;
          this.airWarned = false;
          this.hud.inventory(s);
          if (lost.length) this.hud.toast(t('airLost', { x: lost.join(' ') }), 3);
          this.save();
        },
        2.2,
        '#bfe6ff',
      );
    }
  }

  private footCamera(dt: number): void {
    const p = this.player;
    const surf = this.surface!;
    const dist = 7.5;
    const fx = Math.sin(this.footYaw);
    const fz = Math.cos(this.footYaw);
    const target = _v.copy(p.pos).add(_v2.set(0, 1.9, 0));
    const cp = Math.cos(this.footPitch);
    const want = _v3.set(target.x - fx * cp * dist, target.y + Math.sin(this.footPitch) * dist, target.z - fz * cp * dist);
    const g = surf.height(want.x, want.z) + 0.8;
    if (want.y < g) want.y = g;
    if (this.cine > 0) this.cine -= dt;
    this.camera.position.lerp(want, dampFactor(this.cine > 0 ? 2.5 : 14, dt));
    this.camera.lookAt(target);
    if (Math.abs(this.camera.fov - 65) > 0.05) {
      this.camera.fov += (65 - this.camera.fov) * dampFactor(5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private interact(dt: number, useHeld: boolean, scanHeld: boolean): void {
    const surf = this.surface!;
    const p = this.player;
    const s = this.state;
    const dev = this.input.device;
    const use = keyCap('E', 'X', dev);
    let prompt: string | null = null;
    const near = (o: THREE.Vector3, r: number): boolean => Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < r && Math.abs(o.y - p.pos.y) < 3;
    const pressed = this.input.pressed('use');
    const npc = surf.npcs.find((n) => near(n.pos, 3.4));
    const geyser = questActive(s, 'b2') ? surf.geysers.findIndex((g, gi) => !s.sensors.includes(gi) && Math.hypot(g.x - p.pos.x, g.z - p.pos.z) < 2.2) : -1;
    const gear = surf.gears.find((g) => !g.taken && near(g.group.position, 2.8));
    if (geyser < 0) this.sensorProgress = 0;
    if (npc) {
      prompt = `${use}${t('pTalk')}`;
      if (pressed) return this.talk(npc.id);
    } else if (surf.bench && near(surf.bench, 3.2)) {
      prompt = `${use}${t('pBench')} 🔧`;
      if (pressed) return this.openCraft();
    } else if (geyser >= 0) {
      prompt = `${use}${t('pSensor')} 📍`;
      if (useHeld && !surf.geysers[geyser].erupting) {
        this.sensorProgress += dt / 1.5;
        if (Math.random() < dt * 10) sfx.mine();
        if (this.sensorProgress >= 1) {
          this.sensorProgress = 0;
          s.sensors.push(geyser);
          surf.placeSensor(geyser);
          sfx.pickup();
          const msg = t('sensorDone', { n: Math.min(3, s.sensors.length) });
          this.hud.toast(msg, 2.5);
          say(msg);
          this.save();
        }
      } else if (!useHeld) this.sensorProgress = Math.max(0, this.sensorProgress - dt);
    } else if (gear) {
      prompt = `${use}${t('pGear')} ⚙️`;
      if (pressed) {
        gear.taken = true;
        gear.group.visible = false;
        if (!s.gears.includes(gear.idx)) s.gears.push(gear.idx);
        sfx.quest();
        const msg = t('gotGear', { n: s.gears.length });
        this.hud.toast(msg, 3);
        say(msg);
        this.save();
      }
    } else if (near(_v.copy(this.ship.pos).setY(this.ship.pos.y - LAND_H), 4.8)) {
      prompt = `${use}${t('pGetIn')}`;
      if (pressed) {
        this.hud.prompt(null);
        this.hud.scanRing(this.camera, null);
        return this.board();
      }
    } else if (surf.probe && !surf.probe.taken && near(surf.probe.group.position, 3.2)) {
      prompt = `${use}${t('pProbe')}`;
      if (pressed) {
        surf.probe.taken = true;
        surf.probe.group.visible = false;
        s.probe = true;
        sfx.quest();
        this.hud.toast(t('gotProbe'), 3);
        say(t('gotProbe'));
        this.save();
      }
    } else {
      let best: ResourceNode | null = null;
      let bd = 3.0;
      for (const n of surf.resources) {
        if (n.done) continue;
        const d = Math.hypot(n.group.position.x - p.pos.x, n.group.position.z - p.pos.z);
        if (d < bd && Math.abs(n.group.position.y - p.pos.y) < 2.5) {
          bd = d;
          best = n;
        }
      }
      if (best) {
        prompt = `${use}${t('pGather')} ${RES_ICON[best.kind]}`;
        if (useHeld) this.gather(best, dt);
        else best.progress = Math.max(0, best.progress - dt);
      }
    }
    // scanner
    const range = s.scanner2 ? 20 : 9;
    let target: Scannable | null = null;
    let bestScore = -1;
    this.camera.getWorldDirection(_v2);
    for (const c of surf.scannables) {
      const cpos = _v.copy(c.obj.position).add(_v3.set(0, c.centerY * c.obj.scale.y, 0));
      const d = cpos.distanceTo(p.pos);
      if (d > range + 6) continue;
      cpos.sub(this.camera.position).normalize();
      const facing = cpos.dot(_v2);
      if (facing < 0.75) continue;
      const score = facing * 2 - d / range;
      if (score > bestScore) {
        bestScore = score;
        target = c;
      }
    }
    if (target !== this.scanTarget) this.scanProgress = 0;
    this.scanTarget = target;
    this.beam.visible = false;
    if (target) {
      const tp = _v.copy(target.obj.position).add(_v3.set(0, target.centerY * target.obj.scale.y, 0));
      const known = s.finds.includes(target.species);
      const d = tp.distanceTo(p.pos);
      const inRange = d <= range;
      let name = known ? `✓ ${t(target.species)}` : '?';
      if (!known && !inRange) name = t('tooFar');
      surf.holdStill = scanHeld && !known && inRange ? target : null;
      if (scanHeld && !known && inRange) {
        this.scanProgress += dt / (s.scanner2 ? 0.8 : 1.6);
        this.scanTick -= dt;
        if (this.scanTick <= 0) {
          this.scanTick = 0.15;
          sfx.scanTick();
        }
        // the beam from the helmet to the target
        const from = _v3.copy(p.pos).add(_v2.set(0, 1.4, 0));
        this.beam.position.copy(from);
        this.beam.lookAt(tp);
        this.beam.scale.set(1, 1, from.distanceTo(tp));
        this.beam.visible = true;
        this.bean.face(tp.x - p.pos.x, tp.z - p.pos.z);
        if (this.scanProgress >= 1) {
          s.finds.push(target.species);
          sfx.scanDone();
          const msg = t('newFind', { x: t(target.species) });
          this.hud.toast(msg, 3);
          say(msg);
          for (let k = 0; k < 24; k++) surf.fx.emit(tp, _v2.set(rand(-5, 5), rand(-2, 6), rand(-5, 5)), 0x4cfcd2, 1.2, 0.9, { g: 6 });
          this.hud.tracker(s);
          this.save();
        }
      } else this.scanProgress = Math.max(0, this.scanProgress - dt);
      if (!prompt && !known && inRange) prompt = `${keyCap('F', 'RT', this.input.device)}${t('pScan')}`;
      this.hud.scanRing(this.camera, tp, known ? 1 : this.scanProgress, name, known);
    } else {
      this.hud.scanRing(this.camera, null);
      surf.holdStill = null;
    }
    this.hud.prompt(prompt);
  }

  private gather(n: ResourceNode, dt: number): void {
    const surf = this.surface!;
    const p = this.player;
    n.progress += dt / 1.1;
    const tp = _v.copy(n.group.position).add(_v2.set(0, 0.8, 0));
    const from = _v3.copy(p.pos).add(_v2.set(0, 1.0, 0));
    this.beam.position.copy(from);
    this.beam.lookAt(tp);
    this.beam.scale.set(2, 2, from.distanceTo(tp));
    this.beam.visible = true;
    this.bean.face(tp.x - p.pos.x, tp.z - p.pos.z);
    n.group.position.x += Math.sin(this.time * 60) * 0.01;
    if (Math.random() < dt * 20) {
      surf.fx.emit(tp, _v2.set(rand(-3, 3), rand(1, 4), rand(-3, 3)), n.kind === 'fruit' ? 0xffb347 : n.kind === 'ice' ? 0xbfefff : 0xff8fd8, 0.9, 0.6, { g: 10 });
      sfx.mine();
    }
    if (n.progress >= 1) {
      n.done = true;
      n.group.visible = false;
      const st = this.state;
      st.inv[n.kind] += n.amount;
      if (!st.got.includes(n.uid)) st.got.push(n.uid);
      sfx.pickup();
      this.hud.toast(t('gotItem', { n: n.amount, x: `${RES_ICON[n.kind]} ${t(n.kind)}` }), 1.6);
      this.hud.inventory(st, n.kind);
      for (let k = 0; k < 16; k++) surf.fx.emit(tp, _v2.set(rand(-4, 4), rand(2, 7), rand(-4, 4)), 0xffe47a, 1.2, 0.8, { g: 12 });
      this.hud.tracker(st);
      this.save();
    }
  }

  private talk(npc: NpcId): void {
    const s = this.state;
    const st = s.npc[npc];
    const q = currentQuest(s, npc);
    const name = couch?.name || (getLang() === 'no' ? 'venn' : 'friend');
    const close = { label: t('ok'), action: () => this.closeOverlay() };
    this.hud.prompt(null);
    this.hud.scanRing(this.camera, null);
    if (!q) return this.dialog(t(`${npc}AllDone`), '', [close], npc);
    if (!st.acc) {
      const hello = st.i === 0 ? t(`${npc}Hello`, { name }) + ' ' : '';
      const blocked = q.blocked?.(s);
      if (blocked) return this.dialog(hello + t(blocked), '', [close], npc);
      this.dialog(
        hello + t(q.offer),
        `🎁 ${t('reward')}: <b>${t(q.reward)}</b>`,
        [
          {
            label: t('ok'),
            action: () => {
              st.acc = true;
              this.npcReady[npc] = questReady(s, npc);
              s.target = q.planet;
              this.hud.tracker(s);
              this.closeOverlay();
              this.hud.toast(t('questNew'));
              sfx.quest();
              this.save();
            },
          },
        ],
        npc,
      );
      return;
    }
    if (questReady(s, npc)) {
      this.dialog(
        t(q.thanks),
        `🎁 <b>${t(q.reward)}</b>`,
        [
          {
            label: t('yay'),
            action: () => {
              q.complete(s);
              st.i += 1;
              st.acc = false;
              this.npcReady[npc] = false;
              sfx.quest();
              this.applyGear();
              this.hud.inventory(s);
              this.hud.tracker(s);
              this.save();
              if (s.jetpack && q.id === 'p1') this.hud.toast(t('jetpackHint'), 4);
              // straight on to the next job
              const next = currentQuest(s, npc);
              if (next) this.talk(npc);
              else this.closeOverlay();
            },
          },
        ],
        npc,
      );
      return;
    }
    const objs = q.objectives(s).map((o) => `${o.icon} ${t(o.label)} ${o.need > 1 ? `${o.have}/${o.need}` : ''}${o.have >= o.need ? ' ✓' : ''}`).join('<br>');
    this.dialog(t(`${npc}Busy`), objs, [close], npc);
  }

  private checkQuest(): void {
    for (const npc of Object.keys(QUESTS) as NpcId[]) {
      const ready = questReady(this.state, npc);
      if (ready && !this.npcReady[npc]) {
        const msg = npc === 'pip' ? t('questComplete') : t('questCompleteBolt');
        this.hud.toast(msg, 3.5);
        say(msg);
        sfx.quest();
        this.state.target = NPC_HOME[npc];
      }
      this.npcReady[npc] = ready;
    }
  }

  // ================================================================== HUD

  private updateHud(): void {
    if (this.mode === 'title') return;
    const s = this.state;
    const dev = this.input.device;
    const k = (kb: string, pad: string) => keyCap(kb, pad, dev);
    const markers: Marker[] = [];
    const css = (hex: number) => '#' + hex.toString(16).padStart(6, '0');
    this.hud.tracker(s);
    this.hud.inventory(s);
    if (this.race.running) this.hud.race(`⏱ ${this.race.time.toFixed(1)} s<small>${t('raceRing', { n: this.race.next, m: this.race.count })} · 🥇 ${RACE_MEDALS[0]} s</small>`);
    else this.hud.race(this.raceMsg > 0 ? this.lastRace : null);
    if (this.mode === 'space' || this.mode === 'air') {
      const ship = this.ship;
      const target = planetById(s.target);
      let alt: number | null = null;
      let tgt = `🎯 ${t(target.id)}`;
      if (this.mode === 'space') {
        const camUp = _v3.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        for (const p of PLANETS) {
          const d = ship.pos.distanceTo(p.pos) - p.radius;
          markers.push({
            // above the planet's disc rather than on top of it
            pos: p.pos.clone().addScaledVector(camUp, p.radius * 1.3),
            label: t(p.id),
            sub: p.locked && !s.hyperdrive ? `🔒 ${(d / 1000).toFixed(1)} km` : `${(d / 1000).toFixed(1)} km`,
            color: css(p.atmosphere),
            target: p.id === s.target,
          });
        }
        tgt += ` · ${((ship.pos.distanceTo(target.pos) - target.radius) / 1000).toFixed(1)} km`;
        // the ring race: the next ring, or the start ring when you are near Pebble
        const r = this.race;
        const ring = r.rings[r.running ? r.next : 0];
        const d = ring.pos.distanceTo(ship.pos);
        if (r.running || d < 1400 || questActive(s, 'b3')) {
          markers.push({ pos: ring.pos.clone().add(_v.set(0, RING_R + 8, 0)), label: r.running ? `${r.next + 1}/${r.count}` : `🏁 ${t('race')}`, sub: `${Math.round(d)} m`, color: '#ffd23f', target: r.running });
        }
      } else {
        const surf = this.surface!;
        alt = ship.pos.y - surf.height(ship.pos.x, ship.pos.z);
        markers.push({ pos: _v.set(0, 2, 0).clone(), label: 'H', sub: t('landHere'), color: '#ffd23f', target: s.target === surf.def.id });
        if (surf.probe && !surf.probe.taken) markers.push({ pos: surf.probe.group.position, label: '📡', sub: t('probe'), color: '#ff5d73' });
        if (s.target !== surf.def.id) tgt = `▲ ${t('flyUp')}`;
      }
      this.hud.flight(true, ship.speed / ship.params.boostSpeed, ship.energy / ship.params.energy, alt, tgt, this.autopilot);
      this.hud.jet(false);
      this.hud.reticle(false);
      const rows: [string, string][] =
        dev === 'gamepad'
          ? [
              [k('', 'LS ↕'), t('cThrottle')],
              [k('', 'RS'), t('cSteer')],
              [k('', 'LS ↔'), t('cRoll')],
              [k('', 'A'), t('cBoost')],
              [k('', 'LT'), t('cSlide')],
              [k('', 'Y'), t('cTarget')],
              [k('', 'B'), t('cAuto')],
            ]
          : [
              [k('W', '') + k('S', ''), t('cThrottle')],
              [k('↑↓←→', ''), t('cSteer')],
              [k('Q', '') + k('E', ''), t('cRoll')],
              [k('A', '') + k('D', ''), t('cStrafe')],
              [k('Shift', ''), t('cBoost')],
              [k('Space', ''), t('cSlide')],
              [k('Tab', ''), t('cTarget')],
              [k('Z', ''), t('cAuto')],
            ];
      if (this.mode === 'air') rows.push([k('L', 'X'), t('cLand')]);
      if (this.mode === 'space' && s.hyperdrive) rows.push([k('H', 'RB'), t('cHyper')]);
      rows.push([k('J', 'View'), t('cLog')], [k('Esc', 'Start'), t('cPause')]);
      this.hud.controls(rows);
      if (this.mode === 'space') this.hud.prompt(null);
      else if (!this.autoLand && this.takeoff <= 0 && alt !== null && alt < 70) this.hud.prompt(`${k('L', 'X')}${t('cLand')}`);
      else this.hud.prompt(null);
      this.hud.scanRing(this.camera, null);
    } else if (this.mode === 'foot') {
      const surf = this.surface!;
      this.hud.flight(false);
      this.hud.reticle(false);
      if (this.ship.pos.distanceTo(this.player.pos) > 14) markers.push({ pos: _v.copy(this.ship.pos).setY(this.ship.pos.y + 3).clone(), label: '🚀', color: '#ff5d73' });
      for (const n of surf.npcs) {
        const q = currentQuest(s, n.id);
        if (n.pos.distanceTo(this.player.pos) > 6) markers.push({ pos: n.pos.clone().setY(n.pos.y + 3.2), label: t(`${n.id}Name`), sub: '💬', color: n.id === 'pip' ? '#ff8c42' : '#3ddc97', target: !!q && (!s.npc[n.id].acc || questReady(s, n.id)) && !q.blocked?.(s) });
      }
      if (surf.bench && surf.bench.distanceTo(this.player.pos) > 5 && surf.bench.distanceTo(this.player.pos) < 40) markers.push({ pos: surf.bench.clone().setY(surf.bench.y + 2.6), label: '🔧', color: '#ffc93c' });
      for (const g of surf.gears) if (!g.taken) markers.push({ pos: g.group.position.clone().setY(g.group.position.y + 2.2), label: '⚙️', sub: `${Math.round(g.group.position.distanceTo(this.player.pos))} m`, color: '#ffd23f', target: true });
      if (questActive(s, 'b2')) surf.geysers.forEach((g, gi) => {
        if (!s.sensors.includes(gi)) markers.push({ pos: new THREE.Vector3(g.x, g.y + 2.5, g.z), label: '📍', sub: `${Math.round(Math.hypot(g.x - this.player.pos.x, g.z - this.player.pos.z))} m`, color: '#3ddc97' });
      });
      if (surf.probe && !surf.probe.taken) markers.push({ pos: surf.probe.group.position.clone().setY(surf.probe.group.position.y + 2), label: '📡', sub: `${Math.round(surf.probe.group.position.distanceTo(this.player.pos))} m`, color: '#ff5d73', target: true });
      const rows: [string, string][] =
        dev === 'gamepad'
          ? [
              [k('', 'LS'), t('cMove')],
              [k('', 'RS'), t('cLook')],
              [k('', 'A'), s.jetpack ? t('cJet') : t('cJump')],
              [k('', 'X'), t('cUse')],
              [k('', 'RT'), t('cScan')],
              [k('', 'Y'), t('cLog')],
              [k('', 'Start'), t('cPause')],
            ]
          : [
              [k('W', '') + k('A', '') + k('S', '') + k('D', ''), t('cMove')],
              [k('←→↑↓', ''), t('cLook')],
              [k('Space', ''), s.jetpack ? t('cJet') : t('cJump')],
              [k('Shift', ''), t('cRun')],
              [k('E', ''), t('cUse')],
              [k('F', ''), t('cScan')],
              [k('J', ''), t('cLog')],
              [k('Esc', ''), t('cPause')],
            ];
      this.hud.controls(rows);
    }
    this.hud.markers(this.camera, this.overlay ? [] : markers);
  }

  // ================================================================== test hooks

  private testApi(): Record<string, unknown> {
    return {
      info: () => ({
        mode: this.mode,
        overlay: this.overlay,
        where: this.surface?.def.id ?? 'space',
        pos: (this.mode === 'foot' ? this.player.pos : this.ship.pos).toArray().map((x) => Math.round(x)),
        inv: { ...this.state.inv },
        finds: [...this.state.finds],
        quest: this.state.npc.pip.i,
        accepted: this.state.npc.pip.acc,
        ready: questReady(this.state),
        bolt: { ...this.state.npc.bolt, ready: questReady(this.state, 'bolt') },
        air: Math.round(this.air * 100) / 100,
        storm: this.surface?.storm ? { phase: this.surface.storm.phase, amount: Math.round(this.surface.storm.amount * 100) / 100, sheltered: this.surface.sheltered(this.player.pos), fogFar: Math.round((this.surface.scene.fog as THREE.Fog).far) } : null,
        upgrades: [...this.state.upgrades],
        plans: [...this.state.plans],
        paint: this.state.paint,
        hat: this.state.hat,
        sensors: [...this.state.sensors],
        gears: [...this.state.gears],
        got: this.state.got.length,
        raceBest: this.state.raceBest,
        race: { running: this.race.running, next: this.race.next, time: Math.round(this.race.time * 10) / 10 },
        energy: Math.round(this.ship.params.energy),
        slippery: !!this.surface?.slippery(this.player.pos.x, this.player.pos.z),
        nodes: this.surface?.resources.length ?? 0,
        overlayVisible: OVERLAYS.filter((o) => $(o).classList.contains('visible')),
        autopilot: this.autopilot,
        fading: !!this.fade,
        landed: this.ship.landed,
        target: this.state.target,
        jetpack: this.state.jetpack,
        hyperdrive: this.state.hyperdrive,
      }),
      /** Puts the astronaut next to a thing of the given kind, facing it. */
      goNear: (what: string, high = false) => {
        const surf = this.surface;
        if (!surf || this.mode !== 'foot') return false;
        let pos: THREE.Vector3 | null = null;
        let dist = 3;
        const npc = surf.npcs.find((n) => n.id === what);
        if (npc) pos = npc.pos;
        else if (what === 'bench') pos = surf.bench;
        else if (what === 'gear') {
          pos = surf.gears.find((g) => !g.taken)?.group.position ?? null;
          dist = 1.6;
        }
        else if (what === 'geyser') {
          const g = surf.geysers.find((_g, gi) => !this.state.sensors.includes(gi));
          pos = g ? new THREE.Vector3(g.x, g.y, g.z) : null;
          dist = 1.2;
        } else if (what === 'ice-patch') {
          const ip = surf.icePatches[0];
          pos = ip ? new THREE.Vector3(ip.x, 0, ip.z) : null;
          dist = 0.5;
        } else if (what === 'ship') {
          pos = this.ship.pos.clone();
          dist = 3.6;
        } else if (what === 'probe') pos = surf.probe?.group.position ?? null;
        else if (SPECIES.some((x) => x.id === what)) {
          const c = surf.scannables.find((x) => x.species === what);
          pos = c ? c.obj.position.clone() : null;
          dist = 5;
        } else {
          const n = surf.resources.find((r) => !r.done && r.kind === (what as ResourceId) && (r.group.position.y - surf.height(r.group.position.x, r.group.position.z) < 1) !== high);
          pos = n ? n.group.position : null;
          dist = 1.8;
        }
        if (!pos) return false;
        const a = Math.atan2(this.player.pos.z - pos.z, this.player.pos.x - pos.x);
        this.player.pos.set(pos.x + Math.cos(a) * dist, 0, pos.z + Math.sin(a) * dist);
        this.player.pos.y = surf.groundAt(this.player.pos.x, this.player.pos.z, 500);
        this.player.vx = this.player.vz = this.player.vy = 0;
        this.footYaw = Math.atan2(pos.x - this.player.pos.x, pos.z - this.player.pos.z);
        this.footPitch = 0.2;
        this.camera.position.set(this.player.pos.x - Math.sin(this.footYaw) * 7, this.player.pos.y + 3, this.player.pos.z - Math.cos(this.footYaw) * 7);
        return true;
      },
      speciesHere: () => this.surface?.speciesHere().filter((x) => SPECIES.find((y) => y.id === x)?.kind === 'creature') ?? [],
      visit: (id: PlanetId) => {
        this.state.land = [0, 0];
        this.enterSurface(id, 'landed');
      },
      /** The nearest ice pillar with ice on top: position and top height. */
      pillar: () => {
        const surf = this.surface;
        const n = surf?.resources.find((r) => !r.done && r.group.position.y - surf.height(r.group.position.x, r.group.position.z) > 3);
        if (!surf || !n) return null;
        const c = surf.colliders.find((c) => Math.hypot(c.x - n.group.position.x, c.z - n.group.position.z) < 0.5)!;
        // stand beside it, facing it
        const a = Math.atan2(this.player.pos.z - c.z, this.player.pos.x - c.x);
        this.player.pos.set(c.x + Math.cos(a) * (c.r + 1.2), 0, c.z + Math.sin(a) * (c.r + 1.2));
        this.player.pos.y = surf.groundAt(this.player.pos.x, this.player.pos.z, this.player.pos.y + 1);
        this.footYaw = Math.atan2(c.x - this.player.pos.x, c.z - this.player.pos.z);
        return { top: c.top, y: this.player.pos.y };
      },
      setTarget: (id: PlanetId) => {
        this.state.target = id;
      },
      setAir: (x: number) => {
        this.air = x;
      },
      storm: () => this.surface?.forceStorm(),
      /** Stands the astronaut downwind of the biggest mesa (or upwind with exposed = true). */
      mesa: (exposed = false) => {
        const surf = this.surface;
        if (!surf?.storm || !surf.mesas.length) return false;
        const m = [...surf.mesas].sort((a, b) => b.r - a.r)[0];
        const w = surf.storm.wind;
        const k = exposed ? -(m.r + 6) : m.r + 3;
        this.player.pos.set(m.x + w.x * k, 0, m.z + w.z * k);
        this.player.pos.y = surf.groundAt(this.player.pos.x, this.player.pos.z, 500);
        this.player.vx = this.player.vz = this.player.vy = 0;
        return true;
      },
      geyser: () => {
        const g = this.surface?.geysers.find((_g, gi) => !this.state.sensors.includes(gi));
        return g ? { erupting: g.erupting, timer: g.timer, x: g.x, y: g.y, z: g.z } : null;
      },
      give: (r: ResourceId, n: number) => {
        this.state.inv[r] += n;
        this.hud.inventory(this.state);
      },
      useItem: (key: string) => this.useItem(key),
      /** Test setup: overwrite one top-level save field. */
      set: (key: string, value: unknown) => {
        (this.state as unknown as Record<string, unknown>)[key] = value;
        for (const n of Object.keys(this.npcReady) as NpcId[]) this.npcReady[n] = questReady(this.state, n);
        this.hud.inventory(this.state);
      },
      quality: () => ({ q: this.quality, shadows: this.renderer.shadowMap.enabled, ratio: this.renderer.getPixelRatio() }),
      /** Puts the ship in space just before the race's start ring, facing it. */
      raceStart: () => {
        if (this.mode !== 'space') return false;
        const r0 = this.race.rings[0];
        const p = r0.pos.clone().addScaledVector(r0.normal, -160);
        this.ship.placeAt(p, r0.pos, 120);
        this.camQuat.copy(this.ship.quat);
        this.race.reset();
        return true;
      },
      raceAuto: (on: boolean) => {
        this.raceAuto = on;
      },
      thumbs: () => Object.keys(thumbnails(this.renderer)).length,
      bean: () => this.bean.group.position.toArray(),
      charHeight: CHAR_HEIGHT * BEAN_SCALE,
      setSpeed: (n: number) => {
        this.substeps = Math.max(1, Math.round(n));
      },
    };
  }
}
