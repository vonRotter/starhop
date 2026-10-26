import * as THREE from 'three';
import { couch, mountBackButton } from '../couch';
import { sfx, setHum, unlockAudio } from '../core/audio';
import { getLang, onLangChange, setLang, t, type Lang } from '../core/i18n';
import { Input } from '../core/input';
import { clamp, dampFactor, rand } from '../core/math';
import { COLORS } from '../core/palette';
import { say, setVoice, stopVoice, voiceOn } from '../core/voice';
import { Hud, keyCap, RES_ICON, type Marker } from '../ui/hud';
import { renderLog, type LogTab } from '../ui/menus';
import { Bean, CHAR_HEIGHT } from './models';
import { PLANETS, SPECIES, STORM_RADIUS, SUN_RADIUS, planetById, type PlanetDef, type PlanetId, type ResourceId } from './planets';
import { AIR_FLIGHT, SPACE_FLIGHT, Ship } from './ship';
import { Space } from './space';
import { CEILING, FLY_RADIUS, Surface, WALK_RADIUS, type ResourceNode, type Scannable } from './surface';
import {
  QUESTS,
  clearState,
  loadSetting,
  loadState,
  newState,
  questReady,
  saveSetting,
  saveState,
  type GameState,
} from './state';

type Mode = 'title' | 'space' | 'air' | 'foot';
type Overlay = 'title' | 'pause' | 'log' | 'dialog' | null;

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
  private wasReady = false;
  private logTab: LogTab = 'quests';
  private titleAngle = 0;
  private hello = true;
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
    this.space.scene.add(this.ship.root);
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
    onLangChange(() => this.refreshTexts());
    this.wireMenus();
    this.refreshTexts();
    mountBackButton();
    this.titleCamera(0);
    (window as unknown as { __sh: unknown }).__sh = this.testApi();
    requestAnimationFrame(() => this.frame());
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
    for (const id of ['t', 'p']) {
      $(`${id}-voice`).textContent = voiceOn() ? t('voiceOn') : t('voiceOff');
      $(`${id}-voice`).classList.toggle('on', voiceOn());
      $(`${id}-en`).classList.toggle('on', getLang() === 'en');
      $(`${id}-no`).classList.toggle('on', getLang() === 'no');
    }
    const tabs = document.querySelectorAll<HTMLButtonElement>('#log .tabs button');
    const names: Record<string, string> = { quests: t('tabQuests'), finds: t('tabFinds'), gear: t('tabGear') };
    tabs.forEach((b) => (b.textContent = names[b.dataset.tab!]));
    ($('t-continue') as HTMLButtonElement).style.display = loadState() ? '' : 'none';
    if (this.overlay === 'log') this.renderLogPanel();
    this.hud.inventory(this.state);
    this.hud.tracker(this.state);
  }

  private showOverlay(o: Overlay): void {
    for (const id of ['title', 'pause', 'log', 'dialog']) $(id).classList.toggle('visible', id === o);
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
    if (i.pressed('back') && (this.overlay === 'log' || this.overlay === 'pause')) this.closeOverlay();
    else if (i.pressed('log') && this.overlay === 'log') this.closeOverlay();
  }

  private openLog(): void {
    this.showOverlay('log');
    this.renderLogPanel();
    this.focusFirst($('log-close'));
  }

  private renderLogPanel(): void {
    $('log-body').innerHTML = renderLog(this.state, this.logTab);
    document.querySelectorAll<HTMLButtonElement>('#log .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.logTab));
  }

  private dialog(text: string, extra: string, buttons: { label: string; action: () => void }[]): void {
    $('dlg-who').textContent = t('pipName');
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
    say(text, { pitch: 1.25 });
  }

  // ================================================================== game flow

  private newGame(): void {
    clearState();
    this.state = newState();
    this.hello = true;
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
    this.hello = s.quest === 0 && !s.accepted;
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
    this.wasReady = questReady(this.state);
    this.hud.inventory(this.state);
    this.hud.tracker(this.state);
  }

  private toTitle(): void {
    this.mode = 'title';
    this.leaveSurface();
    this.space.scene.add(this.ship.root);
    this.hud.show(false);
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
    this.ship.params = SPACE_FLIGHT;
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
    const surf = new Surface(def, { probe: s.quest === 2 && s.accepted && !s.probe });
    this.surface = surf;
    surf.scene.add(this.ship.root, this.beam);
    surf.fx.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
    this.camera.far = 1500;
    this.camera.updateProjectionMatrix();
    this.ship.params = AIR_FLIGHT;
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
      this.menuInput();
      this.titleCamera(dt);
      this.space.update(dt, this.time, this.camera);
      if (render) this.renderer.render(this.space.scene, this.camera);
      return;
    }
    if (i.pressed('voice')) this.toggleVoice();
    if (this.overlay) {
      this.menuInput();
      if (i.pressed('pause') && this.overlay === 'pause') this.closeOverlay();
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
        this.player.vy = 22;
        this.player.onGround = false;
        this.bean.squash(1.4);
        sfx.geyser();
      }
    } else this.space.update(dt, this.time, this.camera);
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
    s.updateFlight(dt);
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
    this.camera.position.set(p.pos.x - Math.sin(this.footYaw) * 7, p.pos.y + 4.5, p.pos.z - Math.cos(this.footYaw) * 7);
    if (withEffects) {
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
    this.ship.energy = AIR_FLIGHT.energy;
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
    const k = dampFactor(p.onGround ? 12 : 4, dt);
    p.vx += (wx - p.vx) * k;
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
      p.jetFuel = Math.max(0, p.jetFuel - dt / 2.4);
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

    // Pip turns to watch you
    if (surf.pip) {
      const pip = surf.pip;
      pip.face(p.pos.x - surf.pipPos.x, p.pos.z - surf.pipPos.z);
      pip.update(dt, 0, true, 0);
      pip.pivot.position.y = Math.abs(Math.sin(this.time * 2)) * 0.05;
    }
    this.footCamera(dt);
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
    this.camera.position.lerp(want, dampFactor(14, dt));
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
    if (surf.pip && near(surf.pipPos, 3.4)) {
      prompt = `${use}${t('pTalk')}`;
      if (pressed) return this.talk();
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
      sfx.pickup();
      this.hud.toast(t('gotItem', { n: n.amount, x: `${RES_ICON[n.kind]} ${t(n.kind)}` }), 1.6);
      this.hud.inventory(st, n.kind);
      for (let k = 0; k < 16; k++) surf.fx.emit(tp, _v2.set(rand(-4, 4), rand(2, 7), rand(-4, 4)), 0xffe47a, 1.2, 0.8, { g: 12 });
      this.hud.tracker(st);
      this.save();
    }
  }

  private talk(): void {
    const s = this.state;
    const q = QUESTS[s.quest];
    const name = couch?.name || (getLang() === 'no' ? 'venn' : 'friend');
    this.hud.prompt(null);
    this.hud.scanRing(this.camera, null);
    if (!q) {
      this.dialog(t('pipAllDone'), '', [{ label: t('ok'), action: () => this.closeOverlay() }]);
      return;
    }
    if (!s.accepted) {
      const text = (this.hello ? t('pipHello', { name }) + ' ' : '') + t(q.offer);
      this.hello = false;
      this.dialog(text, `🎁 ${t('reward')}: <b>${t(q.reward)}</b>`, [
        {
          label: t('ok'),
          action: () => {
            s.accepted = true;
            this.wasReady = questReady(s);
            if (q.title === 'q2Title' || q.title === 'q3Title') s.target = q.title === 'q2Title' ? 'frost' : 'dune';
            else s.target = 'bloom';
            this.hud.tracker(s);
            this.closeOverlay();
            this.hud.toast(t('questNew'));
            sfx.quest();
            this.save();
          },
        },
      ]);
      return;
    }
    if (questReady(s)) {
      this.dialog(t(q.thanks), `🎁 <b>${t(q.reward)}</b>`, [
        {
          label: t('yay'),
          action: () => {
            q.complete(s);
            s.quest += 1;
            s.accepted = false;
            this.wasReady = false;
            sfx.quest();
            this.hud.inventory(s);
            this.hud.tracker(s);
            this.save();
            if (s.jetpack && q.title === 'q1Title') this.hud.toast(t('jetpackHint'), 4);
            // straight on to the next job
            if (QUESTS[s.quest]) this.talk();
            else this.closeOverlay();
          },
        },
      ]);
      return;
    }
    const objs = q.objectives(s).map((o) => `${o.icon} ${t(o.label)} ${o.need > 1 ? `${o.have}/${o.need}` : ''}${o.have >= o.need ? ' ✓' : ''}`).join('<br>');
    this.dialog(t('pipBusy'), objs, [{ label: t('ok'), action: () => this.closeOverlay() }]);
  }

  private checkQuest(): void {
    const ready = questReady(this.state);
    if (ready && !this.wasReady) {
      this.hud.toast(t('questComplete'), 3.5);
      say(t('questComplete'));
      sfx.quest();
      this.state.target = 'pebble';
    }
    this.wasReady = ready;
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
      if (surf.pip && surf.pipPos.distanceTo(this.player.pos) > 6) markers.push({ pos: surf.pipPos.clone().setY(surf.pipPos.y + 3.2), label: t('pipName'), sub: '💬', color: '#ff8c42', target: !s.accepted || questReady(s) });
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
        quest: this.state.quest,
        accepted: this.state.accepted,
        ready: questReady(this.state),
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
        if (what === 'pip') pos = surf.pipPos;
        else if (what === 'ship') {
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
      charHeight: CHAR_HEIGHT * BEAN_SCALE,
      setSpeed: (n: number) => {
        this.substeps = Math.max(1, Math.round(n));
      },
    };
  }
}
