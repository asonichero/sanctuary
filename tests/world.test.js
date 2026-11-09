import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldColliders } from '../src/world/WorldColliders.js';

test('boxes push a walker out along the nearest face', () => {
  const w = new WorldColliders();
  w.addBounds(-1, -1, 1, 1);
  const p = w.resolve({ x: 1.2, z: 0 }, 0.5);
  assert.ok(Math.abs(p.x - 1.5) < 1e-9 && p.z === 0);
  const inside = w.resolve({ x: 0.9, z: 0.1 }, 0.5); // centre inside: leaves by the +x face
  assert.ok(inside.x >= 1.5 - 1e-9);
});

test('rotated boxes collide in their own frame', () => {
  const w = new WorldColliders();
  w.addBox(0, 0, 4, 0.4, Math.PI / 2); // a wall along Z after rotation
  const p = w.resolve({ x: 0.3, z: 1.5 }, 0.5);
  assert.ok(p.x >= 0.7 - 1e-9, `x=${p.x}`);
  assert.ok(Math.abs(p.z - 1.5) < 1e-9);
});

test('circles and the perimeter boundary', () => {
  const w = new WorldColliders({ boundary: { x: 0, z: 0, r: 10 } });
  w.addCircle(0, 0, 2);
  const p = w.resolve({ x: 1, z: 0 }, 0.5);
  assert.ok(Math.abs(p.x - 2.5) < 1e-9);
  const q = w.resolve({ x: 20, z: 0 }, 0.5);
  assert.ok(Math.abs(q.x - 9.5) < 1e-9);
});

test('floor height is the highest floor under the point', () => {
  const w = new WorldColliders();
  w.addFloorCircle(0, 0, 10, 0.2);
  w.addFloorBox(0, 0, 2, 2, 0.8);
  w.addFloorRing(0, 0, 10.3, 11.3, 0.35);
  assert.equal(w.floorAt(0, 0), 0.8);
  assert.equal(w.floorAt(5, 0), 0.2);
  assert.equal(w.floorAt(10.8, 0), 0.35);
  assert.equal(w.floorAt(30, 0), 0);
});
