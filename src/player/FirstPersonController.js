import * as THREE from 'three';
import { bus, Events } from '../core/EventBus.js';

/** Units: the estate is ~1 unit ≈ 0.7 m; mannequins are ~2.6 units tall. */
export const PLAYER = Object.freeze({
  eye: 2.3, // eye height above the floor (mannequin eyes sit at ~2.3)
  radius: 0.45,
  walk: 5.2, // units per real second
  sprint: 9,
  accel: 14, // how quickly velocity reaches the target speed
  maxStep: 0.9, // tallest ledge you walk up without jumping (studio base is 0.8)
  sensitivity: 0.0022, // radians per mouse pixel
  pitchLimit: 1.45,
  spawn: { x: 0, z: 22, yaw: 0 }, // on the avenue, looking north at the courtyard and house
});

/**
 * FirstPersonController — eye-level walking with pointer-lock mouse look.
 *
 * WASD / arrows move relative to where you're looking, Shift sprints. The
 * player is a circle on the ground plane resolved against `world`
 * (WorldColliders): solids block, floors set the standing height so you step
 * up onto platforms and into buildings, and the perimeter keeps you inside.
 *
 * Click the canvas to take the mouse; Esc releases it. While `lookFrozen`
 * (e.g. a radial menu is open) mouse movement is passed to `onFrozenMove`
 * instead of turning the head.
 */
export class FirstPersonController {
  constructor({ camera, dom, world }) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;

    this.position = new THREE.Vector3(PLAYER.spawn.x, 0, PLAYER.spawn.z); // feet
    this.position.y = world.floorAt(this.position.x, this.position.z);
    this.velocity = new THREE.Vector3();
    this.yaw = PLAYER.spawn.yaw;
    this.pitch = -0.05;
    this.locked = false;
    this.lookFrozen = false;
    this.onFrozenMove = null;
    this._keys = new Set();
    this._bob = 0;
    this._eyeY = this.position.y + PLAYER.eye;

    this._bind();
    this._applyCamera(0);
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  requestLock() {
    if (!this.locked) this.dom.requestPointerLock?.()?.catch?.(() => {});
  }

  _bind() {
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this._keys.clear();
      bus.emit(Events.POINTER_LOCK, { locked: this.locked });
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      // Chrome occasionally reports a huge one-off jump under pointer lock; drop it.
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      if (this.lookFrozen) {
        this.onFrozenMove?.(e.movementX, e.movementY);
        return;
      }
      this.yaw -= e.movementX * PLAYER.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * PLAYER.sensitivity, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    };
    this._onKeyDown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this._keys.add(e.code);
    };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    this._onBlur = () => this._keys.clear();

    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** Movement intent from held keys, in camera-relative axes: x = strafe, z = forward. */
  _intent() {
    const k = this._keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return { f, r, sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  /** Walk for `dt` real seconds (movement is real-time; it doesn't follow the sim speed). */
  update(dt) {
    const { f, r, sprint } = this._intent();
    const fwd = this.forward;
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(sprint ? PLAYER.sprint : PLAYER.walk);
    this.velocity.lerp(wish, Math.min(1, dt * PLAYER.accel));

    this.moveBy(this.velocity.x * dt, this.velocity.z * dt);
    this._applyCamera(dt);
  }

  /** Move the feet by (dx, dz) with collision and step-up. Also used by tests and scripted moves. */
  moveBy(dx, dz) {
    const p = this.position;
    // Substep so fast moves can't tunnel through thin walls.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (PLAYER.radius * 0.5)));
    for (let i = 0; i < steps; i++) {
      const next = { x: p.x + dx / steps, z: p.z + dz / steps };
      this.world.resolve(next, PLAYER.radius);
      const floor = this.world.floorAt(next.x, next.z);
      if (floor - p.y > PLAYER.maxStep) continue; // ledge too tall
      p.x = next.x;
      p.z = next.z;
      p.y = floor;
    }
  }

  /** Teleport the feet (spawn, debug). */
  setPose(x, z, yaw = this.yaw, pitch = this.pitch) {
    this.position.set(x, this.world.floorAt(x, z), z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.velocity.set(0, 0, 0);
    this._eyeY = this.position.y + PLAYER.eye;
    this._applyCamera(0);
  }

  _applyCamera(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this._bob += dt * speed * 1.6;
    const bob = Math.sin(this._bob) * Math.min(1, speed / PLAYER.walk) * 0.045;
    // Ease the eye up/down steps instead of snapping.
    this._eyeY += (this.position.y + PLAYER.eye - this._eyeY) * Math.min(1, dt * 12 || 1);
    this.camera.position.set(this.position.x, this._eyeY + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  dispose() {
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
