import * as THREE from 'three';
import { Noise2D, SeededRandom, clamp, lerp } from '../core/math';
import { COLORS, basic, darken, faceted, glowTexture, mesh, sharedGeo, sphereGeo, toon } from '../core/palette';
import { Particles } from './fx';
import { Bean, makeCreature, makeProbe, makeResource, type CreatureModel } from './models';
import { SPECIES, type PlanetDef, type ResourceId, type SpeciesId } from './planets';

// One planet's landing zone: a bounded heightmap with toon shading, props, wandering creatures,
// scannable plants, resource nodes, and on Pebble the outpost with Pip.

export const SIZE = 420;
const SEG = 168;
/** Players cannot walk further from the centre than this. */
export const WALK_RADIUS = 150;
/** Ships are turned back beyond this. */
export const FLY_RADIUS = 175;
/** Leaving the atmosphere: fly higher than this. */
export const CEILING = 230;

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** World y of the top surface (stand on it). */
  top: number;
  /** Bottom (ground) y; below this nothing collides. */
  bottom: number;
}

export interface Scannable {
  uid: string;
  species: SpeciesId;
  kind: 'creature' | 'plant';
  obj: THREE.Object3D;
  /** Height of the centre above obj.position, for the scan ring. */
  centerY: number;
}

export interface Creature extends Scannable {
  model: CreatureModel;
  home: THREE.Vector2;
  target: THREE.Vector2;
  wait: number;
  speed: number;
  shy: boolean;
  moving: number;
  phase: number;
}

export interface ResourceNode {
  uid: string;
  kind: ResourceId;
  group: THREE.Group;
  amount: number;
  progress: number;
  done: boolean;
}

interface Geyser {
  x: number;
  z: number;
  y: number;
  timer: number;
  erupting: boolean;
}

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;
const skyFrag = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.6));
    float s = max(0.0, dot(d, normalize(uSunDir)));
    col += vec3(1.0, 0.95, 0.8) * (pow(s, 400.0) * 1.5 + pow(s, 12.0) * 0.25);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Surface {
  readonly scene = new THREE.Scene();
  readonly heights = new Float32Array((SEG + 1) * (SEG + 1));
  readonly colliders: Collider[] = [];
  readonly creatures: Creature[] = [];
  readonly scannables: Scannable[] = [];
  readonly resources: ResourceNode[] = [];
  readonly geysers: Geyser[] = [];
  readonly fx = new Particles(900);
  readonly sun: THREE.DirectionalLight;
  readonly sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  probe: { group: THREE.Group; light: THREE.Mesh; taken: boolean } | null = null;
  pip: Bean | null = null;
  /** The creature being scanned holds still (set by the game each frame). */
  holdStill: Scannable | null = null;
  readonly pipPos = new THREE.Vector3(9, 0, 5);
  private readonly noise: Noise2D;
  private readonly noise2: Noise2D;
  private readonly sky: THREE.Mesh;
  private readonly clouds: THREE.Group[] = [];
  private readonly blinkers: THREE.Mesh[] = [];
  private terrain: THREE.Mesh | null = null;

  constructor(readonly def: PlanetDef, opts: { probe: boolean }) {
    this.noise = new Noise2D(def.seed);
    this.noise2 = new Noise2D(def.seed * 7 + 3);
    const s = this.scene;
    s.fog = new THREE.Fog(def.skyHorizon, 140, 560);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: { uTop: { value: new THREE.Color(def.skyTop) }, uHorizon: { value: new THREE.Color(def.skyHorizon) }, uSunDir: { value: this.sunDir } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    s.add(new THREE.HemisphereLight(def.skyTop, darken(def.ground[1], 0.7), def.ambient));
    this.sun = new THREE.DirectionalLight(def.sunColor, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    s.add(this.sun, this.sun.target);
    s.add(this.fx.points);

    this.buildTerrain();
    const rng = new SeededRandom(def.seed * 13 + 1);
    this.buildPad();
    switch (def.id) {
      case 'pebble':
        this.buildPebble(rng);
        break;
      case 'bloom':
        this.buildBloom(rng);
        break;
      case 'frost':
        this.buildFrost(rng);
        break;
      case 'dune':
        this.buildDune(rng, opts.probe);
        break;
    }
    if (def.id !== 'frost') this.buildClouds(rng);
  }

  // ------------------------------------------------------------------ terrain

  /** The shape of the land before grid sampling. */
  private raw(x: number, z: number): number {
    const d = this.def;
    const n = this.noise;
    let h = n.fbm(x * d.hillScale, z * d.hillScale, 4) * d.hillAmp;
    if (d.id === 'frost') h += Math.pow(1 - Math.abs(this.noise2.fbm(x * 0.012, z * 0.012, 3)), 3) * 10 - 4;
    if (d.id === 'dune') h += Math.sin(x * 0.045 + n.noise(x * 0.01, z * 0.01) * 3) * 2.5;
    if (d.id === 'pebble') {
      // a few craters
      for (const [cx, cz, r] of [
        [-60, 40, 18],
        [70, -50, 24],
        [-40, -90, 14],
        [100, 70, 20],
      ]) {
        const dd = Math.hypot(x - cx, z - cz) / r;
        if (dd < 1.6) h += dd < 1 ? -(1 - dd * dd) * r * 0.25 : Math.sin((dd - 1) * Math.PI / 0.6) * r * 0.06;
      }
    }
    const dist = Math.hypot(x, z);
    // flat ground for the landing pad
    const flat = smooth(16, 36, dist);
    h = lerp(0, h, flat);
    // mountains around the edge keep the area bounded
    const edge = smooth(140, 200, dist);
    h += edge * (38 + n.noise(x * 0.03, z * 0.03) * 16);
    return h;
  }

  private buildTerrain(): void {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const h = this.raw(x, z);
      p.setY(i, h);
      // PlaneGeometry rows run from -z (top) to +z; store by grid index
      const gx = Math.round((x + SIZE / 2) / (SIZE / SEG));
      const gz = Math.round((z + SIZE / 2) / (SIZE / SEG));
      this.heights[gz * (SEG + 1) + gx] = h;
    }
    geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const g = this.def.ground;
    const cLow = new THREE.Color(g[0]);
    const cMid = new THREE.Color(g[1]);
    const cHigh = new THREE.Color(g[2]);
    const cAcc = new THREE.Color(g[3]);
    const cRock = new THREE.Color(darken(g[0], 0.78));
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const h = p.getY(i);
      const slope = 1 - nrm.getY(i);
      const t = clamp((h + this.def.hillAmp) / (this.def.hillAmp * 2.2), 0, 1);
      c.copy(cLow).lerp(cMid, smooth(0.2, 0.5, t)).lerp(cHigh, smooth(0.55, 0.9, t));
      const patch = this.noise2.noise(x * 0.06, z * 0.06);
      if (patch > 0.45 && slope < 0.2) c.lerp(cAcc, this.def.id === 'dune' ? 0.35 : 0.55);
      if (slope > 0.28 || h > 34) c.lerp(cRock, smooth(0.28, 0.5, slope) * 0.8 + (h > 34 ? 0.3 : 0));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const terrain = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    terrain.receiveShadow = true;
    this.terrain = terrain;
    this.scene.add(terrain);
  }

  /** Ground height (terrain only), bilinear over the grid. */
  height(x: number, z: number): number {
    const cell = SIZE / SEG;
    const fx = clamp((x + SIZE / 2) / cell, 0, SEG - 0.001);
    const fz = clamp((z + SIZE / 2) / cell, 0, SEG - 0.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const H = this.heights;
    const r = SEG + 1;
    // match the triangle split of PlaneGeometry (a-b-d / b-c-d)
    const h00 = H[iz * r + ix];
    const h10 = H[iz * r + ix + 1];
    const h01 = H[(iz + 1) * r + ix];
    const h11 = H[(iz + 1) * r + ix + 1];
    if (tx + tz < 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** Highest surface to stand on under (x, z) at or below y + step. */
  groundAt(x: number, z: number, y: number, radius = 0.4): number {
    let g = this.height(x, z);
    for (const c of this.colliders) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + radius * 0.3) * (c.r + radius * 0.3) && c.top <= y + 0.6 && c.top > g) g = c.top;
    }
    return g;
  }

  /** Pushes a point out of colliders it is inside (below their tops). */
  collide(p: THREE.Vector3, radius: number, height = 1.6): void {
    for (const c of this.colliders) {
      if (p.y >= c.top - 0.5 || p.y + height < c.bottom) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.001;
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
      }
    }
  }

  // ------------------------------------------------------------------ placement helpers

  private spot(rng: SeededRandom, minR = 28, maxR = 140, clear = 3): { x: number; z: number; y: number } {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.range((minR / maxR) ** 2, 1)) * maxR;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + clear)) continue;
      // keep clear of the pad and Pip's houses
      if (Math.hypot(x, z) < minR) continue;
      return { x, z, y: this.height(x, z) };
    }
    const x = rng.range(-100, 100);
    const z = rng.range(-100, 100);
    return { x, z, y: this.height(x, z) };
  }

  private add(o: THREE.Object3D, x: number, z: number, y = this.height(x, z)): THREE.Object3D {
    o.position.set(x, y, z);
    this.scene.add(o);
    return o;
  }

  private rock(rng: SeededRandom, color: number, scale: number): void {
    const p = this.spot(rng, 24, 145, 2);
    const g = mesh(sharedGeo(`rock${rng.int(0, 2)}`, () => faceted(new THREE.DodecahedronGeometry(1, 0))), toon(color));
    g.scale.set(scale * rng.range(0.8, 1.4), scale * rng.range(0.6, 1), scale * rng.range(0.8, 1.3));
    g.rotation.set(rng.next(), rng.next() * 6, rng.next());
    g.castShadow = true;
    this.add(g, p.x, p.z, p.y + scale * 0.3);
    if (scale > 1.2) this.colliders.push({ x: p.x, z: p.z, r: scale * 0.9, top: p.y + scale * 0.9, bottom: p.y - 1 });
  }

  private addCreature(rng: SeededRandom, species: SpeciesId, n: number, near?: { x: number; z: number }): void {
    for (let i = 0; i < n; i++) {
      const p = near ? { x: near.x + rng.range(-20, 20), z: near.z + rng.range(-20, 20) } : this.spot(rng, 30, 135, 2);
      const model = makeCreature(species);
      const c: Creature = {
        uid: `${this.def.id}.${species}.${i}`,
        species,
        kind: 'creature',
        obj: model.group,
        centerY: model.hover + 0.7,
        model,
        home: new THREE.Vector2(p.x, p.z),
        target: new THREE.Vector2(p.x, p.z),
        wait: rng.range(0, 3),
        speed: species === 'shellby' ? 0.8 : species === 'scuttle' ? 3.2 : species === 'skyjelly' ? 1.2 : 2.2,
        shy: species === 'bouncer' || species === 'scuttle' || species === 'flutter',
        moving: 0,
        phase: rng.range(0, 10),
      };
      model.group.position.set(p.x, this.height(p.x, p.z) + model.hover, p.z);
      model.group.rotation.y = rng.next() * 6.28;
      if (species === 'skyjelly') model.group.scale.setScalar(1.6);
      this.scene.add(model.group);
      this.creatures.push(c);
      this.scannables.push(c);
    }
  }

  private addPlant(rng: SeededRandom, species: SpeciesId, n: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.spot(rng, 26, 140, 3);
      const model = makeCreature(species);
      model.group.rotation.y = rng.next() * 6.28;
      this.add(model.group, p.x, p.z);
      this.scannables.push({ uid: `${this.def.id}.${species}.${i}`, species, kind: 'plant', obj: model.group, centerY: 1.0 });
      this.creatures.push({
        uid: '',
        species,
        kind: 'plant',
        obj: model.group,
        centerY: 1,
        model,
        home: new THREE.Vector2(p.x, p.z),
        target: new THREE.Vector2(p.x, p.z),
        wait: 1e9,
        speed: 0,
        shy: false,
        moving: 0,
        phase: rng.range(0, 10),
      });
      this.colliders.push({ x: p.x, z: p.z, r: 0.5, top: p.y + 1.6, bottom: p.y - 1 });
    }
  }

  private addResource(kind: ResourceId, x: number, z: number, y: number, amount: number): void {
    const g = makeResource(kind);
    g.position.set(x, y, z);
    g.rotation.y = (x * 13 + z * 7) % 6.28;
    this.scene.add(g);
    this.resources.push({ uid: `${this.def.id}.${kind}.${this.resources.length}`, kind, group: g, amount, progress: 0, done: false });
  }

  private resourcesAround(rng: SeededRandom, kind: ResourceId, n: number, amount: number, minR = 30): void {
    for (let i = 0; i < n; i++) {
      const p = this.spot(rng, minR, 130, 3);
      this.addResource(kind, p.x, p.z, p.y, amount);
    }
  }

  // ------------------------------------------------------------------ builders

  private buildPad(): void {
    const g = new THREE.Group();
    const base = mesh(sharedGeo('padBase', () => new THREE.CylinderGeometry(8, 8.6, 0.6, 32)), toon(0x5a5478));
    base.position.y = 0.05;
    base.receiveShadow = true;
    const top = mesh(sharedGeo('padTop', () => new THREE.CylinderGeometry(7.2, 7.2, 0.62, 32)), toon(0xece6ff));
    top.position.y = 0.06;
    top.receiveShadow = true;
    const ring = mesh(sharedGeo('padRing', () => new THREE.TorusGeometry(5.2, 0.28, 8, 40)), toon(COLORS.gold));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    g.add(base, top, ring);
    for (const [w, d, x] of [
      [0.6, 4, -1.2],
      [0.6, 4, 1.2],
      [2.4, 0.6, 0],
    ] as [number, number, number][]) {
      const bar = mesh(sharedGeo(`H${w}${d}`, () => new THREE.BoxGeometry(w, 0.1, d)), toon(COLORS.coral), x, 0.38, 0);
      g.add(bar);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = mesh(sphereGeo(0.25, 10, 8), basic(0x7fffd4), Math.cos(a) * 7.8, 0.45, Math.sin(a) * 7.8);
      this.blinkers.push(l);
      g.add(l);
    }
    this.add(g, 0, 0, 0);
  }

  private buildClouds(rng: SeededRandom): void {
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      const n = rng.int(3, 5);
      for (let j = 0; j < n; j++) {
        const puff = mesh(sphereGeo(1, 12, 8), toon(0xffffff, { transparent: true, opacity: 0.9 }), j * 5 - n * 2.5, rng.range(-1, 1.5), rng.range(-2, 2));
        puff.scale.setScalar(rng.range(4, 7));
        c.add(puff);
      }
      c.position.set(rng.range(-250, 250), rng.range(90, 150), rng.range(-250, 250));
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  private buildPebble(rng: SeededRandom): void {
    // outpost: domes, an antenna and crates around the pad
    const domes: [number, number, number, number][] = [
      [-16, -8, 6, COLORS.cream],
      [-12, 12, 4.5, COLORS.candyMint],
      [16, -12, 5, COLORS.candyPink],
    ];
    for (const [x, z, r, col] of domes) {
      const y = this.height(x, z);
      const d = mesh(sharedGeo(`dome${r}`, () => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), toon(col));
      d.castShadow = true;
      this.add(d, x, z, y - 0.2);
      const door = mesh(sharedGeo(`door${r}`, () => new THREE.CylinderGeometry(1.1, 1.1, 0.4, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2)), toon(COLORS.sky));
      door.scale.set(1, 1.7, 1);
      const dir = new THREE.Vector2(-x, -z).normalize();
      door.position.set(x + dir.x * r * 0.98, y, z + dir.y * r * 0.98);
      door.rotation.y = Math.atan2(dir.x, dir.y);
      this.scene.add(door);
      for (let k = 0; k < 3; k++) {
        const a = Math.atan2(dir.y, dir.x) + (k - 1) * 0.6;
        const win = mesh(sphereGeo(0.5, 10, 8), basic(0xfff0a0), x + Math.cos(a) * r * 0.85, y + r * 0.5, z + Math.sin(a) * r * 0.85);
        win.scale.set(1, 1, 0.4);
        if (k !== 1) this.scene.add(win);
      }
      this.colliders.push({ x, z, r: r * 0.95, top: y + r, bottom: y - 2 });
    }
    const ax = 14;
    const az = 14;
    const ay = this.height(ax, az);
    const mast = mesh(sharedGeo('mast', () => new THREE.CylinderGeometry(0.25, 0.45, 12, 8)), toon(0xd8d4ee), ax, ay + 6, az);
    const dish = mesh(sharedGeo('bigDish', () => new THREE.SphereGeometry(2.4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3)), toon(0xfffffe), ax, ay + 11.5, az);
    dish.rotation.x = -0.6;
    (dish.material as THREE.Material).side = THREE.DoubleSide;
    const tip = mesh(sphereGeo(0.4), basic(0xff3355), ax, ay + 12.4, az);
    this.blinkers.push(tip);
    this.scene.add(mast, dish, tip);
    this.colliders.push({ x: ax, z: az, r: 0.7, top: ay + 12, bottom: ay - 1 });
    for (let i = 0; i < 4; i++) {
      const cx = -6 + i * 1.6;
      const cz = -13;
      const crate = mesh(sharedGeo('crate', () => new THREE.BoxGeometry(1.4, 1.4, 1.4)), toon(i % 2 ? COLORS.tangerine : COLORS.candyYellow));
      crate.castShadow = true;
      this.add(crate, cx, cz, this.height(cx, cz) + 0.7 + (i === 3 ? 1.4 : 0));
    }
    this.colliders.push({ x: -3.6, z: -13, r: 3.2, top: 1.4, bottom: -2 });
    // Pip
    this.pip = new Bean(COLORS.tangerine, { cap: true });
    this.pip.group.scale.setScalar(1.45);
    this.pipPos.y = this.height(this.pipPos.x, this.pipPos.z);
    this.pip.group.position.copy(this.pipPos);
    this.scene.add(this.pip.group);
    this.colliders.push({ x: this.pipPos.x, z: this.pipPos.z, r: 0.6, top: this.pipPos.y + 1.6, bottom: this.pipPos.y - 1 });
    for (let i = 0; i < 26; i++) this.rock(rng, rng.next() < 0.5 ? 0x8d7fc4 : 0xa898dc, rng.range(0.6, 2.6));
    this.addPlant(rng, 'glowcap', 6);
    this.resourcesAround(rng, 'crystal', 5, 1, 30);
    this.addCreature(rng, 'rockpup', 4, { x: 30, z: 26 });
  }

  private buildBloom(rng: SeededRandom): void {
    for (let i = 0; i < 46; i++) {
      const p = this.spot(rng, 30, 145, 4);
      const tree = new THREE.Group();
      const h = rng.range(3, 6);
      const trunk = mesh(sharedGeo('trunk', () => new THREE.CylinderGeometry(0.35, 0.55, 1, 8).translate(0, 0.5, 0)), toon(COLORS.trunk));
      trunk.scale.y = h;
      tree.add(trunk);
      const leafCol = rng.pick([COLORS.leaf, COLORS.leafLight, 0x3fae5a, COLORS.candyPink]);
      for (let j = 0; j < 3; j++) {
        const leaf = mesh(sphereGeo(1, 14, 10), toon(leafCol), rng.range(-0.8, 0.8), h + j * 0.8, rng.range(-0.8, 0.8));
        leaf.scale.setScalar(rng.range(1.6, 2.4) - j * 0.3);
        leaf.castShadow = true;
        tree.add(leaf);
      }
      trunk.castShadow = true;
      this.add(tree, p.x, p.z, p.y - 0.2);
      this.colliders.push({ x: p.x, z: p.z, r: 0.7, top: p.y + h + 2.5, bottom: p.y - 1 });
    }
    // little flowers (decor)
    for (let i = 0; i < 90; i++) {
      const p = this.spot(rng, 18, 145, 0.5);
      const f = new THREE.Group();
      f.add(mesh(sharedGeo('fstem', () => new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4).translate(0, 0.25, 0)), toon(COLORS.leaf)));
      f.add(mesh(sphereGeo(0.14, 8, 6), toon(rng.pick([COLORS.candyPink, COLORS.candyYellow, COLORS.white, COLORS.candyLilac])), 0, 0.55, 0));
      this.add(f, p.x, p.z);
    }
    for (let i = 0; i < 14; i++) this.rock(rng, COLORS.rock, rng.range(0.6, 2.2));
    this.addPlant(rng, 'sunpuff', 7);
    this.resourcesAround(rng, 'fruit', 9, 1, 28);
    this.resourcesAround(rng, 'crystal', 2, 1, 60);
    this.addCreature(rng, 'bouncer', 6);
    this.addCreature(rng, 'shellby', 5);
    this.addCreature(rng, 'flutter', 5);
  }

  private buildFrost(rng: SeededRandom): void {
    // ice pillars: hexagonal columns with flat tops you can stand on; most carry ice on top
    for (let i = 0; i < 14; i++) {
      const p = this.spot(rng, 32, 135, 6);
      const r = rng.range(2.2, 3.4);
      const h = rng.range(6, 11);
      const col = mesh(sharedGeo(`pillar${i % 3}`, () => faceted(new THREE.CylinderGeometry(1, 1.15, 1, 6).translate(0, 0.5, 0))), toon(i % 2 ? 0xbfe9ff : 0xa6dcff));
      col.scale.set(r, h + 3, r);
      col.castShadow = true;
      this.add(col, p.x, p.z, p.y - 3);
      const top = p.y + h;
      const cap = mesh(sharedGeo('snowcap', () => new THREE.CylinderGeometry(1.05, 1, 0.4, 6)), toon(COLORS.white), p.x, top + 0.1, p.z);
      cap.scale.set(r, 1, r);
      this.scene.add(cap);
      this.colliders.push({ x: p.x, z: p.z, r: r * 0.95, top: top + 0.3, bottom: p.y - 3 });
      if (i < 8) this.addResource('ice', p.x, p.z, top + 0.3, 1);
    }
    for (let i = 0; i < 40; i++) {
      const p = this.spot(rng, 24, 145, 1.5);
      const sp = mesh(sharedGeo('spike', () => faceted(new THREE.ConeGeometry(0.6, 1, 5).translate(0, 0.5, 0))), toon(0xd6f6ff));
      const h = rng.range(1.5, 4.5);
      sp.scale.set(rng.range(0.8, 1.4), h, rng.range(0.8, 1.4));
      sp.rotation.set(rng.range(-0.25, 0.25), rng.next() * 6, rng.range(-0.25, 0.25));
      sp.castShadow = true;
      this.add(sp, p.x, p.z, p.y - 0.2);
      if (h > 2.5) this.colliders.push({ x: p.x, z: p.z, r: 0.6, top: p.y + h, bottom: p.y - 1 });
    }
    for (let i = 0; i < 10; i++) this.rock(rng, 0xc8d4ee, rng.range(0.6, 2));
    // geysers
    for (let i = 0; i < 7; i++) {
      const p = i === 0 ? { x: 26, z: -14, y: this.height(26, -14) } : this.spot(rng, 28, 125, 4);
      const vent = mesh(sharedGeo('vent', () => new THREE.TorusGeometry(1.3, 0.45, 8, 16)), toon(0x9ab8d8), p.x, p.y + 0.15, p.z);
      vent.rotation.x = Math.PI / 2;
      const hole = mesh(sharedGeo('hole', () => new THREE.CircleGeometry(1.1, 16)), toon(0x2b4a6a), p.x, p.y + 0.12, p.z);
      hole.rotation.x = -Math.PI / 2;
      this.scene.add(vent, hole);
      this.geysers.push({ x: p.x, z: p.z, y: p.y, timer: rng.range(0, 5), erupting: false });
    }
    this.resourcesAround(rng, 'ice', 3, 1, 26);
    this.addPlant(rng, 'frostbell', 6);
    this.addCreature(rng, 'waddle', 6);
    this.addCreature(rng, 'snowpuff', 5);
  }

  private buildDune(rng: SeededRandom, probe: boolean): void {
    // mesas
    for (let i = 0; i < 7; i++) {
      const p = this.spot(rng, 40, 135, 10);
      const r = rng.range(5, 9);
      const h = rng.range(6, 13);
      const m = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const layer = mesh(sharedGeo(`mesa${k}`, () => faceted(new THREE.CylinderGeometry(1 - k * 0.08, 1.05 - k * 0.08, 1, 9).translate(0, 0.5, 0))), toon([0xe08a50, 0xf2b36b, 0xd97a45][k]));
        layer.scale.set(r, h / 3 + 0.01, r);
        layer.position.y = (k * h) / 3 - 2;
        layer.castShadow = true;
        m.add(layer);
      }
      this.add(m, p.x, p.z, p.y);
      this.colliders.push({ x: p.x, z: p.z, r: r * 0.95, top: p.y + h - 2, bottom: p.y - 3 });
    }
    for (let i = 0; i < 22; i++) this.rock(rng, rng.next() < 0.5 ? 0xd98a4a : 0xc77a45, rng.range(0.6, 2.4));
    this.addPlant(rng, 'spinecactus', 8);
    this.resourcesAround(rng, 'crystal', 10, 2, 28);
    this.addCreature(rng, 'scuttle', 6);
    this.addCreature(rng, 'skyjelly', 4);
    if (probe) {
      const pr = makeProbe();
      const x = 92;
      const z = -78;
      this.add(pr.group, x, z, this.height(x, z) - 0.2);
      this.probe = { group: pr.group, light: pr.light, taken: false };
      // a trail of smoke from the crash
      const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4466, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      beam.scale.setScalar(6);
      beam.position.y = 1.4;
      pr.group.add(beam);
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number, time: number, player: THREE.Vector3, focus: THREE.Vector3, camera: THREE.Camera): { geyserLaunch: boolean } {
    this.sky.position.copy(camera.position);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 120);
    this.sun.target.position.copy(focus);
    for (const c of this.clouds) {
      c.position.x += dt * 2;
      if (c.position.x > 260) c.position.x = -260;
    }
    for (const b of this.blinkers) b.visible = Math.sin(time * 4 + b.position.x) > -0.3;
    if (this.probe && !this.probe.taken) this.probe.light.visible = Math.sin(time * 6) > 0;
    // creatures
    for (const c of this.creatures) {
      if (c.kind === 'plant') {
        c.model.animate(time + c.phase, 0);
        continue;
      }
      const o = c.obj.position;
      if (c === this.holdStill) {
        c.moving = Math.max(0, c.moving - dt * 4);
        c.model.animate(time + c.phase, c.moving);
        continue;
      }
      const dxp = o.x - player.x;
      const dzp = o.z - player.z;
      const dp = Math.hypot(dxp, dzp);
      let speed = c.speed;
      if (c.shy && dp < 4.5) {
        // hop away a little, then settle again
        c.target.set(o.x + (dxp / (dp + 0.01)) * 6, o.z + (dzp / (dp + 0.01)) * 6);
        c.wait = 0;
        speed *= 1.8;
      }
      if (c.wait > 0) {
        c.wait -= dt;
        c.moving = Math.max(0, c.moving - dt * 4);
        if (c.wait <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 14;
          c.target.set(c.home.x + Math.cos(a) * r, c.home.y + Math.sin(a) * r);
        }
      } else {
        const dx = c.target.x - o.x;
        const dz = c.target.y - o.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) c.wait = 1 + Math.random() * 3;
        else {
          o.x += (dx / d) * speed * dt;
          o.z += (dz / d) * speed * dt;
          const yaw = Math.atan2(dx, dz);
          let dy = yaw - c.obj.rotation.y;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          c.obj.rotation.y += dy * Math.min(1, dt * 6);
          c.moving = Math.min(1, c.moving + dt * 4);
        }
      }
      // stay in the play area and off the colliders
      const rr = Math.hypot(o.x, o.z);
      if (rr > WALK_RADIUS - 5) {
        o.x *= (WALK_RADIUS - 5) / rr;
        o.z *= (WALK_RADIUS - 5) / rr;
      }
      o.y = this.height(o.x, o.z);
      if (c.model.hover < 3) this.collide(o, c.model.radius, 1);
      o.y = this.height(o.x, o.z) + c.model.hover;
      c.model.animate(time + c.phase, c.moving);
    }
    // geysers
    let launch = false;
    const tmp = new THREE.Vector3();
    const vel = new THREE.Vector3();
    for (const g of this.geysers) {
      g.timer -= dt;
      if (g.timer <= 0) {
        g.erupting = !g.erupting;
        g.timer = g.erupting ? 2.2 : 3.5 + Math.random() * 2;
      }
      if (g.erupting) {
        for (let i = 0; i < 3; i++) {
          tmp.set(g.x + (Math.random() - 0.5), g.y + 0.5, g.z + (Math.random() - 0.5));
          vel.set((Math.random() - 0.5) * 2, 14 + Math.random() * 8, (Math.random() - 0.5) * 2);
          this.fx.emit(tmp, vel, 0xffffff, 2.2, 1.4, { g: 6, grow: 2, drag: 0.6 });
        }
        if (Math.hypot(player.x - g.x, player.z - g.z) < 1.8 && player.y < g.y + 3) launch = true;
      } else if (Math.random() < dt * 3) {
        tmp.set(g.x, g.y + 0.4, g.z);
        vel.set(0, 2, 0);
        this.fx.emit(tmp, vel, 0xeaf6ff, 1.2, 1.2, { grow: 1.5 });
      }
    }
    this.fx.update(dt);
    return { geyserLaunch: launch };
  }

  /** True when some species on this planet has any scannable left to find. */
  speciesHere(): SpeciesId[] {
    return SPECIES.filter((s) => s.planet === this.def.id).map((s) => s.id);
  }

  /** Frees the per-visit GPU resources (shared toon materials and cached geometry stay). */
  dispose(): void {
    this.terrain?.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sky.geometry.dispose();
    this.fx.points.geometry.dispose();
    this.sun.shadow.map?.dispose();
  }
}
