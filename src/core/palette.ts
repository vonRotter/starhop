import * as THREE from 'three';

// Couch Party Island's look: bright palette and three-band toon shading (ported from couch/src/core/palette.js).
export const COLORS = {
  grass: 0x7ad65a,
  grassDark: 0x58b947,
  dirt: 0xd99a62,
  sand: 0xf7e1a6,
  water: 0x56c6f0,
  trunk: 0xa0704a,
  leaf: 0x4cc46a,
  leafLight: 0x86e070,
  rock: 0xbdb8cf,
  rockDark: 0x9a94b2,
  candyPink: 0xff9fd0,
  candyBlue: 0x8fd8ff,
  candyYellow: 0xffe47a,
  candyMint: 0x9ff0c8,
  candyLilac: 0xc9a8ff,
  gold: 0xffd23f,
  white: 0xffffff,
  ink: 0x2b2340,
  blush: 0xff8fa8,
  cream: 0xfff3dc,
  coral: 0xff5d73,
  sky: 0x4cc9f0,
  tangerine: 0xff8c42,
  grape: 0x9b5de5,
  mint: 0x3ddc97,
};

let gradientMap: THREE.DataTexture | null = null;
export function getGradientMap(): THREE.DataTexture {
  if (!gradientMap) {
    // Three soft bands: shadow, mid, lit.
    const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
    gradientMap = new THREE.DataTexture(data, 3, 1);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

const cache = new Map<string, THREE.Material>();

export interface ToonOpts {
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  vertexColors?: boolean;
}

/** Shared toon material. Cached and never disposed. */
export function toon(color: number, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const key = `t|${color}|${o.transparent}|${o.opacity}|${o.emissive}|${o.vertexColors}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: getGradientMap(),
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0,
      vertexColors: o.vertexColors ?? false,
    });
    if (o.transparent) m.depthWrite = false;
    cache.set(key, m);
  }
  return m;
}

export function basic(color: number, o: { transparent?: boolean; opacity?: number; additive?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `b|${color}|${o.transparent}|${o.opacity}|${o.additive}`;
  let m = cache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !o.transparent,
    });
    cache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Recomputes normals per face so toon shading reads as low-poly facets. */
export function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/** Shared geometry, created once. */
export function sharedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const sphereGeo = (r: number, w = 16, h = 12): THREE.BufferGeometry =>
  sharedGeo(`sph${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function darken(hex: number, f: number): number {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}

/** A soft round glow sprite texture (canvas), shared. */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  return glowTex;
}
