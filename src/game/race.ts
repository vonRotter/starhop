import * as THREE from 'three';
import { SeededRandom } from '../core/math';
import { basic, faceted, mesh, sharedGeo, toon } from '../core/palette';
import { planetById } from './planets';

// Bolt's ring race: a loop of big rings around Pebble with an asteroid belt in between. Fly
// through the first ring to start the clock; the next ring glows gold.

export const RING_R = 24;
const COUNT = 10;

export interface Ring {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  mesh: THREE.Mesh;
}

export type RaceEvent = 'start' | 'ring' | 'finish' | 'lost' | 'bump' | null;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Race {
  readonly group = new THREE.Group();
  readonly rings: Ring[] = [];
  readonly rocks: { pos: THREE.Vector3; r: number }[] = [];
  running = false;
  next = 0;
  time = 0;
  private readonly matNext = toon(0xffd23f, { emissive: 0x806000 });
  private readonly matOn = toon(0x4cfcd2, { emissive: 0x106050 });
  private readonly matDone = toon(0x9a94b2, { transparent: true, opacity: 0.35 });

  constructor() {
    const P = planetById('pebble').pos;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < COUNT; i++) {
      const a = 2.86 + i * 0.55;
      const r = 560 + Math.sin(i * 1.7) * 80;
      pts.push(new THREE.Vector3(P.x + Math.cos(a) * r, P.y + Math.sin(i * 1.1) * 120, P.z + Math.sin(a) * r));
    }
    const geo = sharedGeo('raceRing', () => new THREE.TorusGeometry(RING_R, 2.2, 10, 40));
    pts.forEach((p, i) => {
      const n = (i < COUNT - 1 ? _a.subVectors(pts[i + 1], p) : _a.subVectors(p, pts[i - 1])).normalize().clone();
      const m = mesh(geo, this.matOn);
      m.position.copy(p);
      m.lookAt(_b.copy(p).add(n));
      // a little light at the top of each ring so they read from far away
      const bulb = mesh(sharedGeo('ringBulb', () => new THREE.SphereGeometry(3, 10, 8)), basic(0xffffff), 0, RING_R + 3, 0);
      m.add(bulb);
      this.group.add(m);
      this.rings.push({ pos: p, normal: n, mesh: m });
    });
    // asteroids along the course, kept clear of the racing line
    const rng = new SeededRandom(77);
    for (let tries = 0; tries < 400 && this.rocks.length < 40; tries++) {
      const a = 2.6 + rng.next() * 5.4;
      const r = rng.range(380, 760);
      const pos = new THREE.Vector3(P.x + Math.cos(a) * r, P.y + rng.range(-160, 160), P.z + Math.sin(a) * r);
      const size = rng.range(7, 22);
      let clear = true;
      for (let i = 0; i < COUNT - 1 && clear; i++) {
        const line = new THREE.Line3(pts[i], pts[i + 1]);
        line.closestPointToPoint(pos, true, _a);
        if (_a.distanceTo(pos) < size + RING_R + 20) clear = false;
      }
      if (!clear) continue;
      const rock = mesh(sharedGeo(`ast${tries % 3}`, () => faceted(new THREE.DodecahedronGeometry(1, tries % 3 === 0 ? 1 : 0))), toon(rng.pick([0x9a94b2, 0xbdb8cf, 0x8d7fc4])));
      rock.scale.set(size, size * rng.range(0.7, 1), size * rng.range(0.8, 1.2));
      rock.rotation.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
      rock.position.copy(pos);
      this.group.add(rock);
      this.rocks.push({ pos, r: size });
    }
    this.paint();
  }

  /** Recolours the rings: the next one gold, passed ones faded. */
  private paint(): void {
    this.rings.forEach((r, i) => {
      r.mesh.material = !this.running ? (i === 0 ? this.matNext : this.matOn) : i < this.next ? this.matDone : i === this.next ? this.matNext : this.matOn;
    });
  }

  reset(): void {
    this.running = false;
    this.next = 0;
    this.time = 0;
    this.paint();
  }

  private crossed(ring: Ring, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d0 = _a.subVectors(a, ring.pos).dot(ring.normal);
    const d1 = _b.subVectors(b, ring.pos).dot(ring.normal);
    if ((d0 < 0) === (d1 < 0)) return false;
    const t = d0 / (d0 - d1);
    _a.copy(a).lerp(b, t);
    return _a.distanceTo(ring.pos) < RING_R + 1.5;
  }

  /** Moves the race on from the ship's last position to its new one. */
  update(dt: number, prev: THREE.Vector3, cur: THREE.Vector3, vel: THREE.Vector3): RaceEvent {
    let ev: RaceEvent = null;
    // asteroids bounce you off gently
    for (const r of this.rocks) {
      const d = cur.distanceTo(r.pos);
      if (d < r.r + 3) {
        _a.subVectors(cur, r.pos).normalize();
        cur.copy(r.pos).addScaledVector(_a, r.r + 3);
        const vn = vel.dot(_a);
        if (vn < 0) vel.addScaledVector(_a, -vn * 1.5);
        vel.multiplyScalar(0.6);
        ev = 'bump';
      }
    }
    if (this.crossed(this.rings[0], prev, cur)) {
      this.running = true;
      this.next = 1;
      this.time = 0;
      this.paint();
      return 'start';
    }
    if (!this.running) return ev;
    this.time += dt;
    if (this.crossed(this.rings[this.next], prev, cur)) {
      this.next += 1;
      if (this.next >= COUNT) {
        this.running = false;
        this.next = 0;
        this.paint();
        return 'finish';
      }
      this.paint();
      return 'ring';
    }
    const home = planetById('pebble').pos;
    if (this.time > 150 || cur.distanceTo(home) > 2600) {
      this.reset();
      return 'lost';
    }
    return ev;
  }

  get count(): number {
    return COUNT;
  }
}
