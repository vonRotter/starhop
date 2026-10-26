export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent smoothing factor for exponential approach (from Tachyon). */
export const dampFactor = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, dampFactor(lambda, dt));
export const rand = (lo = 0, hi = 1): number => lo + Math.random() * (hi - lo);
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Small deterministic PRNG so planets look the same every visit. */
export class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hiInclusive: number): number {
    return Math.floor(this.range(lo, hiInclusive + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

/** 2D value noise with smooth interpolation; fbm sums octaves. Deterministic per seed. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly vals = new Float32Array(256);
  constructor(seed: number) {
    const r = new SeededRandom(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.vals[i] = r.next() * 2 - 1;
  }
  private v(x: number, y: number): number {
    return this.vals[this.perm[(this.perm[x & 255] + y) & 255]];
  }
  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const a = this.v(xi, yi);
    const b = this.v(xi + 1, yi);
    const c = this.v(xi, yi + 1);
    const d = this.v(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  }
  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
}
