import * as THREE from 'three';

export type PlanetId = 'pebble' | 'bloom' | 'frost' | 'dune';
export type ResourceId = 'crystal' | 'ice' | 'fruit';
export type SpeciesId =
  | 'rockpup'
  | 'bouncer'
  | 'shellby'
  | 'flutter'
  | 'waddle'
  | 'snowpuff'
  | 'scuttle'
  | 'skyjelly'
  | 'glowcap'
  | 'sunpuff'
  | 'frostbell'
  | 'spinecactus';

export interface SpeciesDef {
  id: SpeciesId;
  kind: 'creature' | 'plant';
  planet: PlanetId;
  color: number;
}

export const SPECIES: SpeciesDef[] = [
  { id: 'rockpup', kind: 'creature', planet: 'pebble', color: 0xb9a8e6 },
  { id: 'glowcap', kind: 'plant', planet: 'pebble', color: 0x7ef0e0 },
  { id: 'bouncer', kind: 'creature', planet: 'bloom', color: 0xff8fc8 },
  { id: 'shellby', kind: 'creature', planet: 'bloom', color: 0xffd23f },
  { id: 'flutter', kind: 'creature', planet: 'bloom', color: 0x9b5de5 },
  { id: 'sunpuff', kind: 'plant', planet: 'bloom', color: 0xffc93c },
  { id: 'waddle', kind: 'creature', planet: 'frost', color: 0x3a4a8a },
  { id: 'snowpuff', kind: 'creature', planet: 'frost', color: 0xffffff },
  { id: 'frostbell', kind: 'plant', planet: 'frost', color: 0x8fd8ff },
  { id: 'scuttle', kind: 'creature', planet: 'dune', color: 0xff6b3d },
  { id: 'skyjelly', kind: 'creature', planet: 'dune', color: 0xc9a8ff },
  { id: 'spinecactus', kind: 'plant', planet: 'dune', color: 0x3ddc97 },
];

export interface PlanetDef {
  id: PlanetId;
  /** Position in the star system (the sun is at the origin). */
  pos: THREE.Vector3;
  radius: number;
  /** Space look: banded colours from low to high ground. */
  bands: number[];
  atmosphere: number;
  ring?: number;
  /** Behind the space storm: reachable only with the hyperdrive. */
  locked?: boolean;
  seed: number;
  // surface
  skyTop: number;
  skyHorizon: number;
  ground: [number, number, number, number]; // low, mid, high, accent
  sunColor: number;
  ambient: number;
  gravity: number;
  hillAmp: number;
  hillScale: number;
}

export const PLANETS: PlanetDef[] = [
  {
    id: 'pebble',
    pos: new THREE.Vector3(2400, 0, 600),
    radius: 170,
    bands: [0x8d7fc4, 0xa898dc, 0xc9b8f0, 0xe6dcff],
    atmosphere: 0xc9a8ff,
    seed: 11,
    skyTop: 0x6f5fc8,
    skyHorizon: 0xffc6e8,
    ground: [0x9a8bd0, 0xb3a5e3, 0xd2c6f4, 0x7ef0e0],
    sunColor: 0xfff0dd,
    ambient: 0.7,
    gravity: 0.75,
    hillAmp: 7,
    hillScale: 0.012,
  },
  {
    id: 'bloom',
    pos: new THREE.Vector3(-900, 150, 3000),
    radius: 330,
    bands: [0x3aa6e0, 0x58b947, 0x7ad65a, 0xf7e1a6],
    atmosphere: 0x8fe8ff,
    seed: 23,
    skyTop: 0x4cc9f0,
    skyHorizon: 0xe9fbff,
    ground: [0x58b947, 0x7ad65a, 0xa4e36a, 0xffe47a],
    sunColor: 0xfff6e0,
    ambient: 0.75,
    gravity: 1,
    hillAmp: 11,
    hillScale: 0.01,
  },
  {
    id: 'frost',
    pos: new THREE.Vector3(-3000, -250, -1500),
    radius: 290,
    bands: [0x8fd8ff, 0xc8eeff, 0xeaf8ff, 0xffffff],
    atmosphere: 0xd8f4ff,
    ring: 0xbfe6ff,
    seed: 37,
    skyTop: 0x3f7fe0,
    skyHorizon: 0xd2e8ff,
    ground: [0xa9d2f2, 0xd2eafc, 0xffffff, 0x6cc0f5],
    sunColor: 0xeef6ff,
    ambient: 0.8,
    gravity: 0.9,
    hillAmp: 15,
    hillScale: 0.011,
  },
  {
    id: 'dune',
    pos: new THREE.Vector3(6200, 400, 5600),
    radius: 360,
    bands: [0xd98a4a, 0xf2b36b, 0xf7d59a, 0xff9fd0],
    atmosphere: 0xffc28a,
    locked: true,
    seed: 53,
    skyTop: 0xff9a6b,
    skyHorizon: 0xffe3b0,
    ground: [0xe9a35e, 0xf5c27e, 0xfadca4, 0xff9fd0],
    sunColor: 0xfff0d0,
    ambient: 0.7,
    gravity: 0.85,
    hillAmp: 9,
    hillScale: 0.008,
  },
];

export const planetById = (id: PlanetId): PlanetDef => PLANETS.find((p) => p.id === id)!;

/** The ion storm around Dune. */
export const STORM_RADIUS = 1500;

export const SUN_RADIUS = 380;
