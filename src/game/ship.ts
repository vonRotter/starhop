import * as THREE from 'three';
import { clamp, dampFactor } from '../core/math';
import { makeShipModel, type ShipModel } from './models';

// Flight model adapted from Tachyon's Ship.updateFlight: velocity chases the nose with finite
// grip, thrust-limited speed changes, boost from an energy tank, and Tachyon's slide (hold to
// keep momentum while the nose swings freely).

export interface FlightParams {
  maxSpeed: number;
  boostSpeed: number;
  strafeSpeed: number;
  accel: number;
  pitchRate: number;
  yawRate: number;
  rollRate: number;
  turnResponse: number;
  energy: number;
  energyRegen: number;
  boostDrain: number;
}

export const SPACE_FLIGHT: FlightParams = {
  maxSpeed: 150,
  boostSpeed: 360,
  strafeSpeed: 40,
  accel: 2.2,
  pitchRate: 1.9,
  yawRate: 1.5,
  rollRate: 3.0,
  turnResponse: 7,
  energy: 100,
  energyRegen: 16,
  boostDrain: 9,
};

export const AIR_FLIGHT: FlightParams = {
  maxSpeed: 46,
  boostSpeed: 95,
  strafeSpeed: 16,
  accel: 2.4,
  pitchRate: 1.5,
  yawRate: 1.35,
  rollRate: 2.6,
  turnResponse: 6,
  energy: 100,
  energyRegen: 20,
  boostDrain: 12,
};

export interface ShipControls {
  pitch: number;
  yaw: number;
  roll: number;
  /** Absolute throttle target -0.25..1. */
  throttle: number;
  strafeX: number;
  strafeY: number;
  boost: boolean;
  slide: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _desired = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Ship {
  readonly model: ShipModel = makeShipModel();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** Local angular velocity: x = pitch, y = yaw, z = roll. */
  readonly angVel = new THREE.Vector3();
  controls: ShipControls = { pitch: 0, yaw: 0, roll: 0, throttle: 0.5, strafeX: 0, strafeY: 0, boost: false, slide: false };
  params: FlightParams = SPACE_FLIGHT;
  energy = 100;
  boosting = false;
  boostLocked = false;
  sliding = false;
  thrust = 0;
  /** Engines off, sitting on the ground. */
  landed = false;

  get root(): THREE.Group {
    return this.model.group;
  }

  get speed(): number {
    return this.vel.length();
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }
  up(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  placeAt(p: THREE.Vector3, lookAt: THREE.Vector3, speed: number): void {
    this.pos.copy(p);
    const m = new THREE.Matrix4().lookAt(p, lookAt, new THREE.Vector3(0, 1, 0));
    this.quat.setFromRotationMatrix(m);
    this.forward(this.vel).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
    this.controls.throttle = clamp(speed / this.params.maxSpeed, 0, 1);
    this.syncTransform();
  }

  syncTransform(): void {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
  }

  updateFlight(dt: number): void {
    const c = this.controls;
    const cls = this.params;
    const k = dampFactor(cls.turnResponse * 0.6, dt);
    const sf = this.vel.length() / cls.maxSpeed;
    const agility = sf < 0.35 ? 0.75 + (sf / 0.35) * 0.35 : sf <= 0.9 ? 1.1 : Math.max(0.68, 1.1 - (sf - 0.9) * 0.4);
    const turn = c.slide ? 1.25 : agility;
    this.angVel.x += (c.pitch * cls.pitchRate * turn - this.angVel.x) * k;
    this.angVel.y += (-c.yaw * cls.yawRate * turn - this.angVel.y) * k;
    this.angVel.z += (-c.roll * cls.rollRate * (0.85 + 0.15 * turn) - this.angVel.z) * k;
    const angle = this.angVel.length() * dt;
    if (angle > 1e-6) {
      _v.copy(this.angVel).normalize();
      _q.setFromAxisAngle(_v, angle);
      this.quat.multiply(_q).normalize();
    }
    this.forward(_fwd);
    this.right(_right);
    this.up(_up);

    if (this.energy <= 1) this.boostLocked = true;
    else if (this.boostLocked && this.energy >= cls.energy * 0.3) this.boostLocked = false;
    const wantsBoost = c.boost && !this.boostLocked;
    this.boosting = wantsBoost;
    if (wantsBoost) this.energy = Math.max(0, this.energy - cls.boostDrain * dt);
    else this.energy = Math.min(cls.energy, this.energy + cls.energyRegen * dt);
    this.sliding = c.slide;

    if (!c.slide) {
      const targetSpeed = wantsBoost ? cls.boostSpeed : clamp(c.throttle, -0.25, 1) * cls.maxSpeed;
      const along = this.vel.dot(_fwd);
      const thrustAccel = wantsBoost ? cls.boostSpeed * 0.55 : cls.maxSpeed * 0.6;
      const brakeAccel = cls.maxSpeed * 0.75;
      const dv = clamp(targetSpeed - along, -brakeAccel * dt, thrustAccel * dt);
      this.vel.addScaledVector(_fwd, dv);
      const pull = Math.abs(this.angVel.x) + Math.abs(this.angVel.y) * 0.6;
      if (along > 20) this.vel.addScaledVector(_fwd, -Math.min(along * 0.5, pull * along * 0.22) * dt);
      _desired.copy(this.vel).addScaledVector(_fwd, -this.vel.dot(_fwd));
      _v2.copy(_right).multiplyScalar(c.strafeX * cls.strafeSpeed).addScaledVector(_up, c.strafeY * cls.strafeSpeed);
      this.vel.addScaledVector(_v2.sub(_desired), dampFactor(cls.accel * 0.85, dt));
      this.thrust = wantsBoost ? 1 : clamp(0.15 + Math.max(0, dv / (thrustAccel * dt + 1e-6)) * 0.6 + c.throttle * 0.4, 0.05, 1);
    } else {
      this.vel.addScaledVector(_right, c.strafeX * cls.strafeSpeed * 1.2 * dt);
      this.vel.addScaledVector(_up, c.strafeY * cls.strafeSpeed * 1.2 * dt);
      if (wantsBoost) this.vel.addScaledVector(_fwd, cls.boostSpeed * 0.9 * dt);
      const sp = this.vel.length();
      if (sp > cls.boostSpeed) this.vel.multiplyScalar(cls.boostSpeed / sp);
      this.thrust = wantsBoost ? 1 : 0.1;
    }
    this.pos.addScaledVector(this.vel, dt);
  }

  /** Gently rolls the wings level with the world (planet flight helper for young pilots). */
  autoLevel(dt: number, strength: number): void {
    this.right(_right);
    const tilt = _right.y; // >0: right wing up
    this.angVel.z += clamp(tilt, -1, 1) * strength * dt * -1;
  }

  updateVisuals(dt: number, time: number): void {
    this.syncTransform();
    const b = this.model.body;
    const bankTarget = this.landed ? 0 : clamp(this.angVel.y * 0.4, -0.55, 0.55);
    const leanTarget = this.landed ? 0 : clamp(-this.angVel.x * 0.06, -0.12, 0.12);
    b.rotation.z += (bankTarget - b.rotation.z) * dampFactor(5, dt);
    b.rotation.x += (leanTarget - b.rotation.x) * dampFactor(5, dt);
    const flicker = 0.85 + Math.sin(time * 60) * 0.08 + Math.random() * 0.07;
    const len = this.landed ? 0.01 : (0.6 + this.thrust * 1.8 + (this.boosting ? 2.6 : 0)) * flicker;
    for (const f of this.model.flames) {
      f.scale.set(this.boosting ? 1.25 : 1, this.boosting ? 1.25 : 1, len);
      f.visible = !this.landed;
    }
    for (const l of this.model.legs) l.visible = this.landed;
    for (const g of this.model.glows) g.visible = !this.landed;
  }
}
