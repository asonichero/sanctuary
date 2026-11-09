/**
 * WorldColliders — 2D walk collision for the first-person player.
 *
 * The estate is mostly upright boxes and cylinders on flat ground, so the
 * player is a circle on the XZ plane: `solids` push it out, `floors` give the
 * standing height (platforms, steps, building slabs), and a circular boundary
 * keeps it inside the perimeter wall. Pure math, no three.js, so it runs in
 * Node tests.
 */
export class WorldColliders {
  constructor({ boundary = { x: 0, z: 0, r: 69 } } = {}) {
    this.boxes = []; // { cx, cz, hx, hz, cos, sin }  (oriented)
    this.circles = []; // { x, z, r }
    this.floors = []; // { kind: 'box'|'circle'|'ring', ..., h }
    this.boundary = boundary;
  }

  /** Solid box centred at (cx, cz), size w × d, rotated `rotY` about Y (three.js convention). */
  addBox(cx, cz, w, d, rotY = 0) {
    this.boxes.push({ cx, cz, hx: w / 2, hz: d / 2, cos: Math.cos(rotY), sin: Math.sin(rotY) });
  }

  /** Solid axis-aligned box by bounds. */
  addBounds(x0, z0, x1, z1) {
    this.addBox((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0));
  }

  addCircle(x, z, r) {
    this.circles.push({ x, z, r });
  }

  addFloorBox(cx, cz, w, d, h) {
    this.floors.push({ kind: 'box', x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h });
  }

  addFloorCircle(x, z, r, h) {
    this.floors.push({ kind: 'circle', x, z, r, h });
  }

  addFloorRing(x, z, r0, r1, h) {
    this.floors.push({ kind: 'ring', x, z, r0, r1, h });
  }

  /** Standing height at (x, z): the highest floor under the point, else 0. */
  floorAt(x, z) {
    let h = 0;
    for (const f of this.floors) {
      if (f.h <= h) continue;
      let inside = false;
      if (f.kind === 'box') inside = x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
      else {
        const d = Math.hypot(x - f.x, z - f.z);
        inside = f.kind === 'circle' ? d <= f.r : d >= f.r0 && d <= f.r1;
      }
      if (inside) h = f.h;
    }
    return h;
  }

  /**
   * Push a circle of `radius` at `p` ({x, z}) out of every solid and back
   * inside the boundary. Mutates and returns `p`.
   */
  resolve(p, radius) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        // Into box space.
        const dx = p.x - b.cx;
        const dz = p.z - b.cz;
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d >= radius) continue;
        if (d < 1e-6) {
          // Centre inside the box: leave by the nearest face.
          const px = b.hx - Math.abs(lx);
          const pz = b.hz - Math.abs(lz);
          if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; d = -px; } else { ox = 0; oz = Math.sign(lz) || 1; d = -pz; }
          const push = radius - d;
          const wx = ox * push, wz = oz * push;
          p.x += wx * b.cos + wz * b.sin;
          p.z += -wx * b.sin + wz * b.cos;
        } else {
          const push = (radius - d) / d;
          const wx = ox * push, wz = oz * push;
          p.x += wx * b.cos + wz * b.sin; // back to world space (inverse rotation)
          p.z += -wx * b.sin + wz * b.cos;
        }
        moved = true;
      }
      for (const c of this.circles) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d >= min) continue;
        if (d < 1e-6) { p.x += min; continue; }
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
        moved = true;
      }
      if (!moved) break;
    }
    const { x, z, r } = this.boundary;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > r - radius) {
      p.x = x + ((p.x - x) / d) * (r - radius);
      p.z = z + ((p.z - z) / d) * (r - radius);
    }
    return p;
  }
}
