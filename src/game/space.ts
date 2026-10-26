import * as THREE from 'three';
import { Noise2D } from '../core/math';
import { glowTexture, toon } from '../core/palette';
import { PLANETS, STORM_RADIUS, SUN_RADIUS, planetById, type PlanetDef } from './planets';

// The star system: a sun, four toon planets with soft atmosphere rims, a starfield over a nebula
// sky, and the ion storm that hides Dune until the hyperdrive is fitted.

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.99999; // always at the far plane
  }
`;
const skyFrag = /* glsl */ `
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    float n = noise(d * 2.5) * 0.6 + noise(d * 5.0) * 0.3 + noise(d * 10.0) * 0.1;
    vec3 base = mix(vec3(0.06, 0.05, 0.2), vec3(0.12, 0.08, 0.3), d.y * 0.5 + 0.5);
    vec3 neb1 = vec3(0.55, 0.2, 0.6) * smoothstep(0.5, 0.85, n);
    vec3 neb2 = vec3(0.1, 0.45, 0.6) * smoothstep(0.55, 0.9, noise(d * 3.0 + 7.0)) * 0.8;
    gl_FragColor = vec4(base + neb1 * 0.55 + neb2 * 0.45, 1.0);
  }
`;
const atmoVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const atmoFrag = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uStrength;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), uPower);
    gl_FragColor = vec4(uColor * f * uStrength, 1.0);
  }
`;
const stormFrag = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  uniform float uTime;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 1.5);
    float s = sin(vP.x * 0.01 + uTime) * sin(vP.y * 0.012 - uTime * 0.7) * sin(vP.z * 0.009 + uTime * 0.5);
    float bolts = smoothstep(0.92, 1.0, sin(vP.x * 0.05 + vP.z * 0.03 + uTime * 3.0)) * step(0.6, fract(uTime * 0.37));
    vec3 col = mix(vec3(0.6, 0.2, 0.9), vec3(0.2, 0.7, 1.0), s * 0.5 + 0.5);
    gl_FragColor = vec4(col * (0.25 + f * 0.9 + abs(s) * 0.25) + vec3(1.0) * bolts * 0.6, 1.0);
  }
`;
const stormVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;

export interface PlanetBody {
  def: PlanetDef;
  group: THREE.Group;
  surface: THREE.Mesh;
}

export class Space {
  readonly scene = new THREE.Scene();
  readonly planets: PlanetBody[] = [];
  private readonly sky: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly storm: THREE.Mesh;
  private readonly stormMat: THREE.ShaderMaterial;
  readonly sunLight: THREE.PointLight;

  constructor() {
    const s = this.scene;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    // stars
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 900, u * 900, r * Math.sin(th) * 900], i * 3);
      c.setHSL([0.6, 0.12, 0.0, 0.8][i % 4], 0.6, 0.75 + Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, depthWrite: false, map: glowTexture(), transparent: true }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    s.add(this.stars);

    // sun
    const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 32, 20), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    s.add(sun);
    for (const [size, color, op] of [
      [SUN_RADIUS * 5, 0xffd060, 0.9],
      [SUN_RADIUS * 12, 0xff9a50, 0.35],
    ] as [number, number, number][]) {
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op }));
      g.scale.setScalar(size);
      s.add(g);
    }
    this.sunLight = new THREE.PointLight(0xfff4e0, 2.6, 0, 0);
    s.add(this.sunLight);
    s.add(new THREE.AmbientLight(0x8a80c0, 0.9));

    for (const def of PLANETS) this.planets.push(this.makePlanet(def));

    // the ion storm around Dune
    this.stormMat = new THREE.ShaderMaterial({
      vertexShader: stormVert,
      fragmentShader: stormFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.storm = new THREE.Mesh(new THREE.SphereGeometry(STORM_RADIUS, 48, 32), this.stormMat);
    this.storm.position.copy(planetById('dune').pos);
    s.add(this.storm);
  }

  private makePlanet(def: PlanetDef): PlanetBody {
    const group = new THREE.Group();
    group.position.copy(def.pos);
    const geo = new THREE.IcosahedronGeometry(def.radius, 5);
    const noise = new Noise2D(def.seed);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const n = noise.fbm(v.x * 3 + v.z * 2, v.y * 3 - v.z, 4) * 0.5 + noise.fbm(v.z * 5, v.x * 5 + v.y, 3) * 0.5;
      const h = n * 0.5 + 0.5;
      const band = h < 0.42 ? 0 : h < 0.55 ? 1 : h < 0.68 ? 2 : 3;
      c.setHex(def.bands[band]);
      // polar caps on Bloom and Frost
      if ((def.id === 'bloom' || def.id === 'frost') && Math.abs(v.y) > 0.85) c.setHex(0xffffff);
      colors.set([c.r, c.g, c.b], i * 3);
      const bump = 1 + (band >= 2 ? (h - 0.55) * 0.05 : 0);
      p.setXYZ(i, v.x * def.radius * bump, v.y * def.radius * bump, v.z * def.radius * bump);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const surface = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    group.add(surface);
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius * 1.12, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        uniforms: { uColor: { value: new THREE.Color(def.atmosphere) }, uPower: { value: 2.2 }, uStrength: { value: 1.1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    );
    group.add(atmo);
    if (def.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.radius * 1.4, def.radius * 2.1, 64),
        new THREE.MeshToonMaterial({ color: def.ring, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2 - 0.35;
      group.add(ring);
    }
    if (def.id === 'pebble') {
      // the outpost: a little twinkling beacon on top of the world
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe47a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      beacon.scale.setScalar(60);
      beacon.position.set(0, def.radius * 1.02, 0);
      group.add(beacon);
    }
    this.scene.add(group);
    return { def, group, surface };
  }

  update(dt: number, time: number, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stormMat.uniforms.uTime.value = time;
    for (const p of this.planets) p.surface.rotation.y += dt * 0.01;
  }
}
