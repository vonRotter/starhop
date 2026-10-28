import * as THREE from 'three';
import { COLORS, basic, darken, faceted, glowTexture, mesh, sharedGeo, sphereGeo, toon } from '../core/palette';
import type { SpeciesId } from './planets';
import type { HatId } from './state';

// ---------------------------------------------------------------------------------------------
// The bean buddy from Couch Party Island, here as an astronaut with a glass helmet and a backpack.
// group sits at the feet; front faces +z.

const BODY_R = 0.42;
const BODY_LEN = 0.36;
export const CHAR_HEIGHT = BODY_LEN + BODY_R * 2;

export class Bean {
  readonly group = new THREE.Group();
  readonly pivot = new THREE.Group();
  private readonly eyes = new THREE.Group();
  private readonly feet: THREE.Mesh[] = [];
  private walk = 0;
  private sq = 1;
  private sqVel = 0;
  private blink = 2 + Math.random() * 3;
  yaw = 0;
  targetYaw = 0;
  readonly jetFlames: THREE.Mesh[] = [];
  private prop: THREE.Group | null = null;
  private hat: THREE.Group | null = null;
  private hatId: HatId = 'none';
  private readonly antenna: THREE.Object3D[] = [];
  private readonly hatY: number;

  constructor(color: number, opts: { helmet?: boolean; cap?: boolean; hat?: HatId } = {}) {
    this.hatY = opts.helmet ? 1.17 : CHAR_HEIGHT - 0.06;
    this.group.add(this.pivot);
    const bodyGeo = sharedGeo('beanBody', () => new THREE.CapsuleGeometry(BODY_R, BODY_LEN, 8, 18));
    const body = mesh(bodyGeo, toon(color), 0, CHAR_HEIGHT / 2, 0);
    body.castShadow = true;
    this.pivot.add(body);
    const belly = mesh(sphereGeo(0.3), toon(0xffffff, { transparent: true, opacity: 0.35 }), 0, 0.42, 0.2);
    belly.scale.set(1, 0.9, 0.7);
    this.pivot.add(belly);
    for (const s of [-1, 1]) {
      const white = mesh(sphereGeo(0.13), toon(COLORS.white), s * 0.15, 0, 0);
      white.scale.set(1, 1.15, 0.6);
      const pupil = mesh(sphereGeo(0.07), toon(COLORS.ink), s * 0.15, -0.01, 0.07);
      const shine = mesh(sphereGeo(0.025, 8, 6), toon(COLORS.white), s * 0.15 + 0.025, 0.03, 0.12);
      this.eyes.add(white, pupil, shine);
    }
    this.eyes.position.set(0, 0.83, 0.33);
    this.pivot.add(this.eyes);
    for (const s of [-1, 1]) {
      const cheek = mesh(sphereGeo(0.07), toon(COLORS.blush), s * 0.28, 0.66, 0.29);
      cheek.scale.set(1, 0.6, 0.4);
      this.pivot.add(cheek);
    }
    for (const s of [-1, 1]) {
      const foot = mesh(sphereGeo(0.13), toon(darken(color, 0.65)), s * 0.18, 0.07, 0.04);
      foot.scale.set(1, 0.6, 1.35);
      foot.castShadow = true;
      this.group.add(foot);
      this.feet.push(foot);
    }
    if (opts.helmet) {
      // a glass bubble over the head, a collar ring, an antenna with a ball, and a backpack
      const glass = mesh(sphereGeo(0.5, 24, 16), toon(0xbfefff, { transparent: true, opacity: 0.32 }), 0, 0.78, 0.02);
      glass.scale.set(1.02, 0.86, 1.02);
      const rim = mesh(sharedGeo('helmetRim', () => new THREE.TorusGeometry(0.43, 0.06, 8, 24)), toon(COLORS.white), 0, 0.42, 0);
      rim.rotation.x = Math.PI / 2;
      const stalk = mesh(sharedGeo('antStalk', () => new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6)), toon(COLORS.ink), 0.2, 1.3, -0.05);
      const ball = mesh(sphereGeo(0.06), toon(COLORS.coral, { emissive: 0x661020 }), 0.2, 1.46, -0.05);
      const pack = mesh(sharedGeo('pack', () => new THREE.BoxGeometry(0.5, 0.5, 0.26)), toon(COLORS.white), 0, 0.55, -0.42);
      const stripe = mesh(sharedGeo('packStripe', () => new THREE.BoxGeometry(0.52, 0.08, 0.27)), toon(COLORS.tangerine), 0, 0.62, -0.42);
      this.pivot.add(glass, rim, stalk, ball, pack, stripe);
      this.antenna.push(stalk, ball);
      for (const s of [-1, 1]) {
        const nozzle = mesh(sharedGeo('nozzle', () => new THREE.CylinderGeometry(0.07, 0.09, 0.16, 10)), toon(0x8a86a0), s * 0.15, 0.27, -0.45);
        const flame = mesh(
          sharedGeo('jetFlame', () => new THREE.ConeGeometry(0.09, 0.55, 10).translate(0, -0.27, 0).rotateX(Math.PI)),
          basic(0xffb347, { transparent: true, opacity: 0.85, additive: true }),
          s * 0.15,
          0.19,
          -0.45,
        );
        flame.rotation.x = Math.PI;
        flame.visible = false;
        this.jetFlames.push(flame);
        this.pivot.add(nozzle, flame);
      }
    }
    if (opts.cap) {
      const cap = mesh(sharedGeo('capDome', () => new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), toon(COLORS.sky), 0, CHAR_HEIGHT - 0.14, 0);
      const stem = mesh(sharedGeo('propStem', () => new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8)), toon(COLORS.ink), 0, CHAR_HEIGHT + 0.21, 0);
      const prop = new THREE.Group();
      prop.position.y = CHAR_HEIGHT + 0.28;
      for (const s of [-1, 1]) prop.add(mesh(sharedGeo('propBlade', () => new THREE.BoxGeometry(0.26, 0.02, 0.08)), toon(s > 0 ? COLORS.candyYellow : COLORS.coral), s * 0.13, 0, 0));
      this.prop = prop;
      this.pivot.add(cap, stem, prop);
    }
    if (opts.hat) this.setHat(opts.hat);
  }

  /** Puts a hat on (Couch Party Island style); 'none' takes it off. */
  setHat(id: HatId): void {
    if (id === this.hatId && (this.hat || id === 'none')) return;
    this.hatId = id;
    if (this.hat) {
      this.hat.removeFromParent();
      this.hat = null;
      this.prop = null;
    }
    for (const a of this.antenna) a.visible = id === 'none';
    if (id === 'none') return;
    const h = makeHat(id);
    h.group.position.y = this.hatY;
    this.hat = h.group;
    if (h.prop) this.prop = h.prop;
    this.pivot.add(h.group);
  }

  squash(amount: number): void {
    this.sq = amount;
    this.sqVel = 0;
  }

  face(dx: number, dz: number): void {
    if (Math.abs(dx) + Math.abs(dz) < 0.01) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  update(dt: number, moving = 0, grounded = true, vy = 0, jet = false): void {
    this.walk += dt * (6 + 10 * moving);
    const bob = grounded ? Math.abs(Math.sin(this.walk)) * 0.07 * moving : 0;
    this.pivot.position.y = bob;
    const swing = grounded ? Math.sin(this.walk) * 0.16 * moving : 0.05;
    this.feet[0].position.z = 0.04 + swing;
    this.feet[1].position.z = 0.04 - swing;
    this.feet[0].position.y = 0.07 + Math.max(0, -swing) * 0.4;
    this.feet[1].position.y = 0.07 + Math.max(0, swing) * 0.4;
    const stretch = grounded ? 1 : 1 + THREE.MathUtils.clamp(vy * 0.012, -0.12, 0.18);
    const acc = (stretch - this.sq) * 320 - this.sqVel * 16;
    this.sqVel += acc * dt;
    this.sq += this.sqVel * dt;
    const s = THREE.MathUtils.clamp(this.sq, 0.5, 1.6);
    const w = 1 / Math.sqrt(s);
    this.pivot.scale.set(w, s, w);
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 14);
    this.group.rotation.y = this.yaw;
    this.blink -= dt;
    this.eyes.scale.y = this.blink < 0 ? 0.12 : 1;
    if (this.blink < -0.12) this.blink = 2 + Math.random() * 3.5;
    for (const f of this.jetFlames) {
      f.visible = jet;
      if (jet) f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }
    if (this.prop) this.prop.rotation.y += dt * 9;
  }
}

/** Helmet gear (science fiction: antenna headset, holo visor, radar dish, welding visor, orbit ring). Base at y = 0. */
export function makeHat(id: HatId): { group: THREE.Group; prop: THREE.Group | null } {
  const g = new THREE.Group();
  let prop: THREE.Group | null = null;
  const glow = (c: number, e: number) => toon(c, { emissive: e });
  switch (id) {
    case 'antenna': {
      // A headband with two springy antennas and glowing tips.
      const band = mesh(sharedGeo('antBand', () => new THREE.TorusGeometry(0.24, 0.035, 6, 20)), toon(COLORS.ink), 0, 0.02, 0);
      band.rotation.x = Math.PI / 2;
      g.add(band);
      for (const sx of [-1, 1]) {
        const stalk = mesh(sharedGeo('antStalk', () => new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6).translate(0, 0.17, 0)), toon(0xc8d0e0), sx * 0.13, 0.02, 0);
        stalk.rotation.z = -sx * 0.35;
        g.add(stalk);
        g.add(mesh(sphereGeo(0.055, 10, 8), glow(COLORS.mint, 0x0c5a3c), sx * 0.25, 0.33, 0));
      }
      break;
    }
    case 'visor': {
      // A curved see-through holo visor across the front of the helmet.
      const vis = mesh(sharedGeo('holoVisor', () => new THREE.CylinderGeometry(0.31, 0.31, 0.12, 20, 1, true, -1.1, 2.2)),
        toon(0x7ff3ff, { emissive: 0x1f6f80, transparent: true, opacity: 0.75 }), 0, -0.12, 0);
      vis.rotation.y = Math.PI;
      const strap = mesh(sharedGeo('holoStrap', () => new THREE.TorusGeometry(0.3, 0.025, 6, 20)), toon(0x9aa3b8), 0, -0.12, 0);
      strap.rotation.x = Math.PI / 2;
      g.add(vis, strap);
      break;
    }
    case 'radar': {
      // A small spinning radar dish on a mast.
      const mast = mesh(sharedGeo('radarMast', () => new THREE.CylinderGeometry(0.03, 0.04, 0.22, 8).translate(0, 0.11, 0)), toon(0x9aa3b8));
      prop = new THREE.Group();
      prop.position.y = 0.24;
      const dish = mesh(sharedGeo('radarDish', () => new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6)), toon(COLORS.white));
      dish.rotation.x = -1.1;
      const tip = mesh(sphereGeo(0.035, 8, 6), glow(COLORS.coral, 0x661020), 0, 0.06, 0.1);
      prop.add(dish, tip);
      g.add(mast, prop);
      break;
    }
    case 'welder': {
      // Bolt's welding visor: a helmet band with a dark flip-up face plate.
      const dome = mesh(sharedGeo('weldDome', () => new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), toon(COLORS.tangerine), 0, -0.06, 0);
      const plate = mesh(sharedGeo('weldPlate', () => new THREE.BoxGeometry(0.42, 0.22, 0.05)), toon(0x34304a), 0, 0.18, 0.2);
      plate.rotation.x = -0.9;
      const lens = mesh(sharedGeo('weldLens', () => new THREE.BoxGeometry(0.26, 0.07, 0.02)), glow(0x3ddc97, 0x0c4a30), 0, 0.2, 0.23);
      lens.rotation.x = -0.9;
      g.add(dome, plate, lens);
      break;
    }
    case 'halo': {
      // A glowing orbit ring floating above the helmet, with two tiny moons.
      const ringMat = toon(COLORS.gold, { emissive: 0x6a5000 });
      const ring = mesh(sharedGeo('orbitRing', () => new THREE.TorusGeometry(0.24, 0.03, 8, 28)), ringMat, 0, 0.22, 0);
      ring.rotation.x = Math.PI / 2 - 0.25;
      prop = new THREE.Group();
      prop.position.y = 0.22;
      for (const a of [0, Math.PI]) prop.add(mesh(sphereGeo(0.05, 8, 6), glow(0x8fe0ff, 0x1f5a80), Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24));
      g.add(ring, prop);
      break;
    }
    default:
      break;
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, prop };
}

// ---------------------------------------------------------------------------------------------
// The player's ship: a chubby toon hopper. Forward is -Z.

export interface ShipModel {
  group: THREE.Group;
  /** Banks and leans (visual only). */
  body: THREE.Group;
  flames: THREE.Mesh[];
  /** Engine glows and halos, dimmed when the engines are off. */
  glows: THREE.Object3D[];
  legs: THREE.Group[];
  cameraOffset: THREE.Vector3;
  /** The hull's own material (ship paint). */
  paint: THREE.MeshToonMaterial;
}

export function makeShipModel(): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hullMat = toon(COLORS.coral).clone();
  const trim = toon(COLORS.cream);
  const dark = toon(0x4a4366);
  const hull = mesh(sharedGeo('shipHull', () => new THREE.CapsuleGeometry(1.15, 2.6, 8, 18).rotateX(Math.PI / 2)), hullMat);
  hull.scale.set(1, 0.8, 1);
  hull.castShadow = true;
  const nose = mesh(sphereGeo(0.55), trim, 0, -0.05, -2.45);
  nose.scale.set(1, 0.8, 0.8);
  const canopy = mesh(sphereGeo(0.85, 20, 14), toon(0x7fe3ff, { emissive: 0x0a3040 }), 0, 0.62, -0.9);
  canopy.scale.set(0.85, 0.62, 1.25);
  const stripe = mesh(sharedGeo('shipStripe', () => new THREE.TorusGeometry(1.08, 0.14, 8, 24)), trim, 0, 0, 0.4);
  stripe.scale.set(1, 0.82, 1);
  body.add(hull, nose, canopy, stripe);
  // wings
  const wingGeo = sharedGeo('wing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.9);
    s.lineTo(3.0, 0.2);
    s.lineTo(3.1, -0.5);
    s.lineTo(0, -1.2);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.11, 0);
    return g;
  });
  for (const side of [-1, 1]) {
    const w = mesh(wingGeo, trim, side * 0.6, -0.15, 0.6);
    w.scale.x = side;
    w.castShadow = true;
    const tip = mesh(sphereGeo(0.28), toon(COLORS.candyYellow), side * 3.55, -0.12, 0.75);
    tip.scale.set(0.7, 0.7, 1.6);
    body.add(w, tip);
  }
  const fin = mesh(sharedGeo('fin', () => new THREE.BoxGeometry(0.16, 1.2, 1.3)), toon(COLORS.sky), 0, 1.0, 1.7);
  fin.rotation.x = 0.35;
  body.add(fin);
  // engines and flames
  const flames: THREE.Mesh[] = [];
  const glows: THREE.Object3D[] = [];
  const flameGeo = sharedGeo('shipFlame', () => new THREE.ConeGeometry(0.42, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2));
  for (const side of [-1, 1]) {
    const pod = mesh(sharedGeo('pod', () => new THREE.CylinderGeometry(0.5, 0.42, 1.6, 14).rotateX(Math.PI / 2)), dark, side * 0.85, -0.25, 2.1);
    const glow = mesh(sphereGeo(0.36), basic(0xffd27a), side * 0.85, -0.25, 2.9);
    glow.scale.set(1, 1, 0.3);
    const flame = mesh(flameGeo, basic(0xffa040, { transparent: true, opacity: 0.8, additive: true }), side * 0.85, -0.25, 3.0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(1.8);
    halo.position.set(side * 0.85, -0.25, 3.05);
    flames.push(flame);
    glows.push(glow, halo);
    body.add(pod, glow, flame, halo);
  }
  // landing legs (shown when landed)
  const legs: THREE.Group[] = [];
  for (const [x, z] of [
    [-1.2, -1.0],
    [1.2, -1.0],
    [0, 2.0],
  ] as [number, number][]) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.6, z);
    leg.add(mesh(sharedGeo('leg', () => new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8).translate(0, -0.55, 0)), dark));
    const pad = mesh(sharedGeo('legPad', () => new THREE.CylinderGeometry(0.32, 0.38, 0.12, 12)), trim, 0, -1.1, 0);
    leg.add(pad);
    leg.visible = false;
    legs.push(leg);
    body.add(leg);
  }
  return { group, body, flames, glows, legs, cameraOffset: new THREE.Vector3(0, 3.4, 12.5), paint: hullMat };
}

// ---------------------------------------------------------------------------------------------
// Creatures and scannable plants. Each returns a group (feet at y = 0, facing +z) and an animator.

export interface CreatureModel {
  group: THREE.Group;
  /** t = time, move = 0..1 how fast it is walking. */
  animate(t: number, move: number): void;
  /** Height the creature hovers at (fliers). */
  hover: number;
  radius: number;
}

function eyes(parent: THREE.Object3D, y: number, z: number, spread: number, size = 0.12): void {
  for (const s of [-1, 1]) {
    const white = mesh(sphereGeo(size), toon(COLORS.white), s * spread, y, z);
    const pupil = mesh(sphereGeo(size * 0.55), toon(COLORS.ink), s * spread, y, z + size * 0.6);
    parent.add(white, pupil);
  }
}

export function makeCreature(id: SpeciesId): CreatureModel {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  let animate: (t: number, move: number) => void = () => undefined;
  let hover = 0;
  let radius = 0.7;
  switch (id) {
    case 'rockpup': {
      const b = mesh(faceted(new THREE.IcosahedronGeometry(0.6, 1)), toon(0xb9a8e6), 0, 0.6, 0);
      b.castShadow = true;
      inner.add(b);
      for (let i = 0; i < 4; i++) inner.add(mesh(faceted(new THREE.OctahedronGeometry(0.18)), toon(0x8d7fc4), Math.sin(i * 1.7) * 0.4, 1.0 + (i % 2) * 0.1, -0.2 + i * 0.1));
      eyes(inner, 0.75, 0.48, 0.2, 0.11);
      const legs: THREE.Mesh[] = [];
      for (const [x, z] of [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.25], [0.3, -0.25]]) {
        const l = mesh(sphereGeo(0.14), toon(0x8d7fc4), x, 0.12, z);
        legs.push(l);
        inner.add(l);
      }
      const tail = mesh(sphereGeo(0.12), toon(COLORS.candyMint), 0, 0.7, -0.6);
      inner.add(tail);
      animate = (t, m) => {
        inner.position.y = Math.abs(Math.sin(t * 10)) * 0.12 * m;
        legs.forEach((l, i) => (l.position.y = 0.12 + Math.max(0, Math.sin(t * 10 + i * Math.PI)) * 0.12 * m));
        tail.position.x = Math.sin(t * 14) * 0.15;
      };
      break;
    }
    case 'bouncer': {
      const b = mesh(sphereGeo(0.65, 18, 14), toon(0xff8fc8), 0, 0.65, 0);
      b.castShadow = true;
      inner.add(b);
      for (const s of [-1, 1]) {
        const ear = mesh(sphereGeo(0.16), toon(0xff6fae), s * 0.32, 1.3, -0.05);
        ear.scale.set(0.7, 1.9, 0.6);
        ear.rotation.z = -s * 0.25;
        inner.add(ear);
      }
      eyes(inner, 0.8, 0.52, 0.22, 0.13);
      inner.add(mesh(sphereGeo(0.07), toon(COLORS.ink), 0, 0.62, 0.62));
      animate = (t, m) => {
        const hop = Math.abs(Math.sin(t * 6));
        inner.position.y = hop * (0.25 + 0.7 * m);
        const sq = 1 - (1 - hop) * 0.25;
        inner.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      };
      break;
    }
    case 'shellby': {
      const foot = mesh(sharedGeo('snailFoot', () => new THREE.CapsuleGeometry(0.32, 1.1, 6, 12).rotateX(Math.PI / 2)), toon(0xffd23f), 0, 0.3, 0.1);
      foot.scale.set(1, 0.6, 1);
      const shell = mesh(sharedGeo('shell', () => new THREE.TorusGeometry(0.42, 0.26, 10, 20)), toon(COLORS.candyMint), 0, 0.85, -0.15);
      shell.rotation.y = Math.PI / 2;
      const swirl = mesh(sphereGeo(0.2), toon(0x3ddc97), 0.0, 0.85, -0.15);
      const head = mesh(sphereGeo(0.3), toon(0xffd23f), 0, 0.5, 0.75);
      inner.add(foot, shell, swirl, head);
      for (const s of [-1, 1]) {
        inner.add(mesh(sharedGeo('stalk', () => new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6)), toon(0xffd23f), s * 0.12, 0.95, 0.85));
        inner.add(mesh(sphereGeo(0.09), toon(COLORS.white), s * 0.12, 1.18, 0.85));
        inner.add(mesh(sphereGeo(0.05), toon(COLORS.ink), s * 0.12, 1.19, 0.92));
      }
      animate = (t, m) => {
        inner.scale.z = 1 + Math.sin(t * 4) * 0.06 * m;
      };
      radius = 0.8;
      break;
    }
    case 'flutter': {
      const b = mesh(sharedGeo('flutBody', () => new THREE.CapsuleGeometry(0.14, 0.5, 6, 10).rotateX(Math.PI / 2)), toon(0x5a3d9a), 0, 0, 0);
      inner.add(b);
      eyes(inner, 0.08, 0.32, 0.08, 0.07);
      const wings: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = mesh(sharedGeo('flutWing', () => new THREE.CircleGeometry(0.6, 14).translate(0.6, 0, 0)), toon(s > 0 ? 0x9b5de5 : 0xb57cf0), 0, 0.05, 0);
        (w.material as THREE.Material).side = THREE.DoubleSide;
        w.rotation.x = -Math.PI / 2;
        w.scale.x = s;
        const spot = mesh(sphereGeo(0.12, 8, 6), toon(COLORS.candyYellow), 0.6, 0, 0.02);
        spot.scale.set(1, 1, 0.2);
        w.add(spot);
        wings.push(w);
        inner.add(w);
      }
      hover = 2.2;
      animate = (t) => {
        const f = Math.sin(t * 16) * 0.9;
        wings[0].rotation.z = f;
        wings[1].rotation.z = -f;
        inner.position.y = Math.sin(t * 2) * 0.4;
      };
      radius = 0.6;
      break;
    }
    case 'waddle': {
      const b = mesh(sphereGeo(0.55, 16, 12), toon(0x3a4a8a), 0, 0.75, 0);
      b.scale.set(1, 1.35, 0.95);
      b.castShadow = true;
      const belly = mesh(sphereGeo(0.45), toon(COLORS.white), 0, 0.68, 0.18);
      belly.scale.set(0.95, 1.25, 0.8);
      const beak = mesh(sharedGeo('beak', () => new THREE.ConeGeometry(0.12, 0.3, 8).rotateX(Math.PI / 2)), toon(COLORS.tangerine), 0, 1.05, 0.58);
      inner.add(b, belly, beak);
      eyes(inner, 1.22, 0.42, 0.17, 0.1);
      const fl: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const flipper = mesh(sphereGeo(0.2), toon(0x2a3570), s * 0.55, 0.75, 0);
        flipper.scale.set(0.35, 1.2, 0.7);
        fl.push(flipper);
        inner.add(flipper, mesh(sphereGeo(0.15), toon(COLORS.tangerine), s * 0.2, 0.06, 0.15));
      }
      animate = (t, m) => {
        inner.rotation.z = Math.sin(t * 7) * 0.18 * m;
        fl[0].rotation.z = 0.3 + Math.sin(t * 9) * 0.3;
        fl[1].rotation.z = -0.3 - Math.sin(t * 9) * 0.3;
      };
      break;
    }
    case 'snowpuff': {
      const b = mesh(faceted(new THREE.IcosahedronGeometry(0.55, 1)), toon(COLORS.white), 0, 0, 0);
      inner.add(b);
      for (let i = 0; i < 6; i++) {
        const tuft = mesh(sphereGeo(0.22), toon(0xeaf6ff), Math.cos(i) * 0.45, Math.sin(i * 2.1) * 0.35, Math.sin(i) * 0.4);
        inner.add(tuft);
      }
      eyes(inner, 0.1, 0.5, 0.18, 0.11);
      const wings: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = mesh(sphereGeo(0.2), toon(COLORS.candyBlue), s * 0.65, 0.1, -0.1);
        w.scale.set(1.2, 0.3, 0.8);
        wings.push(w);
        inner.add(w);
      }
      hover = 1.6;
      animate = (t) => {
        inner.position.y = Math.sin(t * 2.5) * 0.35;
        wings[0].rotation.z = Math.sin(t * 12) * 0.6;
        wings[1].rotation.z = -Math.sin(t * 12) * 0.6;
      };
      break;
    }
    case 'scuttle': {
      const b = mesh(sphereGeo(0.55, 16, 10), toon(0xff6b3d), 0, 0.55, 0);
      b.scale.set(1.3, 0.6, 1);
      b.castShadow = true;
      inner.add(b);
      for (const s of [-1, 1]) {
        inner.add(mesh(sharedGeo('crabStalk', () => new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6)), toon(0xff6b3d), s * 0.2, 0.85, 0.3));
        inner.add(mesh(sphereGeo(0.1), toon(COLORS.white), s * 0.2, 1.05, 0.3));
        inner.add(mesh(sphereGeo(0.055), toon(COLORS.ink), s * 0.2, 1.06, 0.38));
        const claw = mesh(sphereGeo(0.22), toon(0xff8c42), s * 0.75, 0.55, 0.45);
        claw.scale.set(1, 0.7, 1.3);
        inner.add(claw);
      }
      const legs: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const s = i < 3 ? -1 : 1;
        const l = mesh(sharedGeo('crabLeg', () => new THREE.CylinderGeometry(0.05, 0.04, 0.55, 5)), toon(0xd9542a), s * 0.7, 0.25, -0.3 + (i % 3) * 0.3);
        l.rotation.z = s * 0.9;
        legs.push(l);
        inner.add(l);
      }
      animate = (t, m) => {
        legs.forEach((l, i) => (l.position.y = 0.25 + Math.sin(t * 18 + i) * 0.07 * m));
        inner.rotation.z = Math.sin(t * 9) * 0.06 * m;
      };
      break;
    }
    case 'skyjelly': {
      const bell = mesh(sharedGeo('bell', () => new THREE.SphereGeometry(0.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), toon(0xc9a8ff, { transparent: true, opacity: 0.8, emissive: 0x302050 }), 0, 0, 0);
      inner.add(bell);
      eyes(inner, 0.35, 0.72, 0.25, 0.12);
      const tent: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const tt = mesh(sharedGeo('tentacle', () => new THREE.CylinderGeometry(0.06, 0.02, 1.6, 5).translate(0, -0.8, 0)), toon(0xff9fd0), Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
        tent.push(tt);
        inner.add(tt);
      }
      hover = 9;
      animate = (t) => {
        const p = Math.sin(t * 2);
        inner.scale.set(1 + p * 0.08, 1 - p * 0.08, 1 + p * 0.08);
        inner.position.y = Math.sin(t * 0.9) * 1.2;
        tent.forEach((tt, i) => (tt.rotation.x = Math.sin(t * 2 + i) * 0.3));
      };
      radius = 1;
      break;
    }
    case 'glowcap': {
      const stem = mesh(sharedGeo('mushStem', () => new THREE.CylinderGeometry(0.18, 0.26, 0.9, 10)), toon(COLORS.cream), 0, 0.45, 0);
      const cap = mesh(sharedGeo('mushCap', () => new THREE.SphereGeometry(0.7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), toon(0x7ef0e0, { emissive: 0x1a6a60 }), 0, 0.85, 0);
      inner.add(stem, cap);
      for (let i = 0; i < 5; i++) inner.add(mesh(sphereGeo(0.09, 8, 6), toon(COLORS.white), Math.cos(i * 1.3) * 0.4, 1.2, Math.sin(i * 1.3) * 0.4));
      animate = (t) => {
        cap.scale.y = 1 + Math.sin(t * 2) * 0.05;
      };
      break;
    }
    case 'sunpuff': {
      const stem = mesh(sharedGeo('flStem', () => new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6)), toon(COLORS.leaf), 0, 0.8, 0);
      const head = new THREE.Group();
      head.position.set(0, 1.7, 0.05);
      head.add(mesh(sphereGeo(0.28), toon(COLORS.tangerine), 0, 0, 0.05));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const p = mesh(sphereGeo(0.2), toon(0xffc93c), Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0);
        p.scale.set(1, 1, 0.35);
        head.add(p);
      }
      eyes(head, 0.06, 0.25, 0.1, 0.06);
      for (const s of [-1, 1]) {
        const leaf = mesh(sphereGeo(0.22), toon(COLORS.leafLight), s * 0.25, 0.6, 0);
        leaf.scale.set(1.4, 0.3, 0.7);
        inner.add(leaf);
      }
      inner.add(stem, head);
      animate = (t) => {
        head.rotation.z = Math.sin(t * 1.5) * 0.2;
      };
      break;
    }
    case 'frostbell': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const stalk = mesh(sharedGeo('fbStalk', () => new THREE.CylinderGeometry(0.04, 0.05, 1.3, 5)), toon(0x6aa8f0), Math.cos(a) * 0.25, 0.65, Math.sin(a) * 0.25);
        const bell = mesh(sharedGeo('fbBell', () => new THREE.ConeGeometry(0.28, 0.4, 10, 1, true)), toon(0x8fd8ff, { emissive: 0x204060 }), Math.cos(a) * 0.3, 1.25, Math.sin(a) * 0.3);
        (bell.material as THREE.Material).side = THREE.DoubleSide;
        inner.add(stalk, bell);
      }
      animate = (t) => {
        inner.rotation.y = Math.sin(t) * 0.2;
      };
      break;
    }
    case 'spinecactus': {
      const b = mesh(sharedGeo('cactus', () => new THREE.CapsuleGeometry(0.4, 1.2, 6, 10)), toon(0x3ddc97), 0, 1.0, 0);
      inner.add(b);
      for (const s of [-1, 1]) {
        const arm = mesh(sharedGeo('cactusArm', () => new THREE.CapsuleGeometry(0.2, 0.5, 6, 8)), toon(0x3ddc97), s * 0.55, 1.2, 0);
        inner.add(arm);
      }
      inner.add(mesh(sphereGeo(0.2), toon(COLORS.candyPink), 0, 1.85, 0));
      eyes(inner, 1.3, 0.36, 0.14, 0.09);
      animate = (t) => {
        inner.scale.y = 1 + Math.sin(t * 1.3) * 0.03;
      };
      break;
    }
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, animate, hover, radius };
}

// ---------------------------------------------------------------------------------------------
// Resource nodes

export function makeResource(kind: 'crystal' | 'ice' | 'fruit'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'crystal') {
    for (let i = 0; i < 5; i++) {
      const h = 0.8 + (i % 3) * 0.45;
      const c = mesh(sharedGeo(`cry${i}`, () => faceted(new THREE.OctahedronGeometry(0.35, 0).scale(1, h * 2, 1))), toon(i % 2 ? 0xff6fae : 0xc77dff, { emissive: 0x401040 }), Math.cos(i * 1.3) * 0.35, h * 0.6, Math.sin(i * 1.3) * 0.35);
      c.rotation.z = Math.cos(i * 2.1) * 0.35;
      c.rotation.x = Math.sin(i * 2.1) * 0.35;
      g.add(c);
    }
  } else if (kind === 'ice') {
    const c = mesh(sharedGeo('iceChunk', () => faceted(new THREE.DodecahedronGeometry(0.6, 0))), toon(0x9ee6ff, { emissive: 0x103850 }), 0, 0.55, 0);
    c.scale.set(1, 0.8, 1);
    const c2 = mesh(sharedGeo('iceChunk2', () => faceted(new THREE.OctahedronGeometry(0.35, 0).scale(1, 2, 1))), toon(0xd6f6ff, { emissive: 0x103850 }), 0.35, 0.9, 0.1);
    g.add(c, c2);
  } else {
    const bush = mesh(sphereGeo(0.85, 14, 10), toon(0x3fae5a), 0, 0.75, 0);
    bush.scale.set(1, 0.85, 1);
    g.add(bush);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const f = mesh(sharedGeo('star', () => faceted(new THREE.OctahedronGeometry(0.2, 0))), toon(COLORS.tangerine, { emissive: 0x402000 }), Math.cos(a) * 0.72, 0.9 + (i % 2) * 0.3, Math.sin(a) * 0.72);
      g.add(f);
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** The lost probe: a little satellite with a blinking light, half buried. */
export function makeProbe(): { group: THREE.Group; light: THREE.Mesh } {
  const g = new THREE.Group();
  const body = mesh(sphereGeo(0.7, 16, 12), toon(0xd8d8e8), 0, 0.5, 0);
  const band = mesh(sharedGeo('probeBand', () => new THREE.TorusGeometry(0.72, 0.1, 8, 20)), toon(COLORS.tangerine), 0, 0.5, 0);
  band.rotation.x = Math.PI / 2;
  const dish = mesh(sharedGeo('dish', () => new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 3)), toon(0xfffffe), 0.3, 1.2, 0);
  dish.rotation.z = -0.6;
  (dish.material as THREE.Material).side = THREE.DoubleSide;
  const light = mesh(sphereGeo(0.16), basic(0xff3355), 0, 1.3, 0);
  for (const s of [-1, 1]) {
    const panel = mesh(sharedGeo('panel', () => new THREE.BoxGeometry(1.2, 0.05, 0.6)), toon(0x4c6ef0), s * 1.35, 0.55, 0);
    panel.rotation.z = s * 0.3;
    g.add(panel);
  }
  g.add(body, band, dish, light);
  g.rotation.z = 0.35;
  return { group: g, light };
}

/** One of Bolt's lost gears: a chunky golden cog. */
export function makeGear(): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(COLORS.gold, { emissive: 0x403000 });
  const wheel = mesh(sharedGeo('gearWheel', () => new THREE.CylinderGeometry(0.55, 0.55, 0.25, 16)), mat, 0, 0.75, 0);
  wheel.rotation.x = Math.PI / 2;
  g.add(wheel);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tooth = mesh(sharedGeo('gearTooth', () => new THREE.BoxGeometry(0.22, 0.22, 0.25)), mat, Math.cos(a) * 0.62, 0.75 + Math.sin(a) * 0.62, 0);
    tooth.rotation.z = a;
    g.add(tooth);
  }
  const hub = mesh(sharedGeo('gearHub', () => new THREE.CylinderGeometry(0.18, 0.18, 0.32, 12)), toon(COLORS.ink), 0, 0.75, 0);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** Bolt's geyser sensor: a little pole with a blinking green light. */
export function makeSensor(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(sharedGeo('sensorPole', () => new THREE.CylinderGeometry(0.06, 0.08, 1.2, 8).translate(0, 0.6, 0)), toon(0xd8d4ee)));
  g.add(mesh(sphereGeo(0.16), basic(0x3ddc97), 0, 1.25, 0));
  return g;
}

/** The workbench in Pip's outpost: a table with tools and a glowing screen. */
export function makeWorkbench(): THREE.Group {
  const g = new THREE.Group();
  const top = mesh(sharedGeo('benchTop', () => new THREE.BoxGeometry(2.6, 0.2, 1.3)), toon(COLORS.tangerine), 0, 1.0, 0);
  g.add(top);
  for (const [x, z] of [
    [-1.1, -0.5],
    [1.1, -0.5],
    [-1.1, 0.5],
    [1.1, 0.5],
  ]) {
    g.add(mesh(sharedGeo('benchLeg', () => new THREE.BoxGeometry(0.16, 1.0, 0.16)), toon(0x5a5478), x, 0.5, z));
  }
  const screen = mesh(sharedGeo('benchScreen', () => new THREE.BoxGeometry(1.1, 0.7, 0.08)), toon(0x4a4366), 0.5, 1.55, -0.45);
  const glow = mesh(sharedGeo('benchGlow', () => new THREE.PlaneGeometry(0.95, 0.55)), basic(0x7fffd4), 0.5, 1.55, -0.4);
  const wrench = mesh(sharedGeo('wrench', () => new THREE.BoxGeometry(0.7, 0.06, 0.12)), toon(0xbdb8cf), -0.6, 1.13, 0.2);
  wrench.rotation.y = 0.5;
  const box = mesh(sharedGeo('toolbox', () => new THREE.BoxGeometry(0.6, 0.35, 0.35)), toon(COLORS.coral), -0.6, 1.28, -0.25);
  const gem = mesh(sharedGeo('cry0', () => faceted(new THREE.OctahedronGeometry(0.35, 0).scale(1, 1.6, 1))), toon(0xff6fae, { emissive: 0x401040 }), 0.2, 1.35, 0.3);
  gem.scale.setScalar(0.5);
  g.add(screen, glow, wrench, box, gem);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}
