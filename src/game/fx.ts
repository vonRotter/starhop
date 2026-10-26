import * as THREE from 'three';
import { glowTexture } from '../core/palette';

// A small pooled particle system (soft round sprites with per-particle colour, size and fade).

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha * 0.8);
  }
`;

interface P {
  life: number;
  max: number;
  size: number;
  grow: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  drag: number;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly ps: P[] = [];
  private next = 0;
  private readonly mat: THREE.ShaderMaterial;

  constructor(private readonly n = 800) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uMap: { value: glowTexture() }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.ps.push({ life: 0, max: 1, size: 1, grow: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0 });
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: number | THREE.Color, size: number, life: number, opts: { g?: number; grow?: number; drag?: number } = {}): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const q = this.ps[i];
    q.life = life;
    q.max = life;
    q.size = size;
    q.grow = opts.grow ?? 0;
    q.vx = v.x;
    q.vy = v.y;
    q.vz = v.z;
    q.g = opts.g ?? 0;
    q.drag = opts.drag ?? 0;
    this.pos.set([p.x, p.y, p.z], i * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.col.set([c.r, c.g, c.b], i * 3);
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      const q = this.ps[i];
      if (q.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      q.life -= dt;
      q.vy -= q.g * dt;
      const d = 1 - Math.min(1, q.drag * dt);
      q.vx *= d;
      q.vy *= d;
      q.vz *= d;
      this.pos[i * 3] += q.vx * dt;
      this.pos[i * 3 + 1] += q.vy * dt;
      this.pos[i * 3 + 2] += q.vz * dt;
      const t = Math.max(0, q.life / q.max);
      this.alpha[i] = Math.min(1, t * 1.6);
      this.size[i] = q.size * (1 + q.grow * (1 - t));
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
