import * as THREE from 'three';
import { makeCreature, makeGear, makeProbe, makeResource } from '../game/models';
import { SPECIES } from '../game/planets';

// Little pictures for the discovery log: each creature, plant and resource model is rendered once
// into a small render target, copied to a 2D canvas and kept as a data URL.

const SIZE = 128;
let cache: Record<string, string> | null = null;

function frame(obj: THREE.Object3D, cam: THREE.PerspectiveCamera): void {
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5;
  const d = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.95;
  cam.position.set(c.x + d * 0.55, c.y + d * 0.35, c.z + d * 0.76);
  cam.lookAt(c);
}

export function thumbnails(renderer: THREE.WebGLRenderer): Record<string, string> {
  if (cache) return cache;
  const out: Record<string, string> = {};
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a80c0, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const px = new Uint8Array(SIZE * SIZE * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g2 = canvas.getContext('2d')!;
  const img = g2.createImageData(SIZE, SIZE);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const shadows = renderer.shadowMap.enabled;
  renderer.setClearColor(0x000000, 0);
  const shoot = (key: string, obj: THREE.Object3D): void => {
    scene.add(obj);
    frame(obj, cam);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, px);
    // flip rows: GL reads bottom-up
    for (let y = 0; y < SIZE; y++) img.data.set(px.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
    g2.putImageData(img, 0, 0);
    out[key] = canvas.toDataURL('image/png');
    scene.remove(obj);
  };
  try {
    for (const sp of SPECIES) {
      const m = makeCreature(sp.id);
      m.animate(0.3, 0);
      m.group.rotation.y = -0.5;
      shoot(sp.id, m.group);
    }
    for (const r of ['crystal', 'ice', 'fruit'] as const) shoot(r, makeResource(r));
    shoot('gear', makeGear());
    shoot('probe', makeProbe().group);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.enabled = shadows;
    rt.dispose();
  }
  cache = out;
  return out;
}
