import * as THREE from 'three';

/**
 * NavGraph — walkable network for residents.
 *
 * Coordinates mirror the layout in EstateBuilder. Residents travel:
 *   current slot → (interior path reversed) → zone node → graph route →
 *   destination node → interior path → destination slot.
 *
 * Indoor zones end at the door: the resident is hidden on arrival and
 * reappears at the door when they leave.
 */

const v = (x, z, y = 0) => new THREE.Vector3(x, y, z);

const NODES = {
  plazaN: v(0, 2),
  plazaE: v(6, 8),
  plazaS: v(0, 14),
  plazaW: v(-6, 8),
  eastJunction: v(28, 8),
  westJunction: v(-30, 8),
  houseDoor: v(0, -13.6),
  residenceDoor: v(-30, 4.6),
  pavilionDoor: v(28, 3.4),
  diningDoor: v(28, 17.6),
  gardensEntry: v(-30, 18.5),
  gate: v(0, 68),
};

const EDGES = [
  // ring around the fountain
  ['plazaN', 'plazaE'], ['plazaE', 'plazaS'], ['plazaS', 'plazaW'], ['plazaW', 'plazaN'],
  ['plazaN', 'houseDoor'],
  ['plazaS', 'gate'],
  ['plazaE', 'eastJunction'], ['eastJunction', 'pavilionDoor'], ['eastJunction', 'diningDoor'],
  ['plazaW', 'westJunction'], ['westJunction', 'residenceDoor'], ['westJunction', 'gardensEntry'],
];

/** Slot generators return [{ pos, via: Vector3[] }] — `via` runs from the zone node to the slot. */
function courtyardSlots() {
  const center = v(0, 8);
  const slots = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = i % 2 ? 5 : 7.5;
    slots.push({ pos: v(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r), via: [] });
  }
  return slots;
}

function pavilionSlots() {
  const c = v(28, -6, 0.8);
  const inner = v(28, -0.5, 0.8);
  const slots = [];
  for (let ring = 0; ring < 2; ring++) {
    const r = ring ? 4.8 : 2.4;
    const n = ring ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      slots.push({ pos: v(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0.8), via: [inner] });
    }
  }
  return slots;
}

function gardenSlots() {
  // Hedge beds sit on a 3×3 grid (spacing 7, size 5) centred at (-30, 30);
  // lanes run at local x = ±3.5 and along the north edge at local z = -10.5.
  const ox = -30, oz = 30;
  const slots = [];
  for (const lx of [-10.5, -7, 7, 10.5]) slots.push({ pos: v(ox + lx, oz - 10.5), via: [] });
  for (const lx of [-3.5, 3.5]) {
    const laneHead = v(ox + lx, oz - 10.5);
    for (const lz of [-7, -3.5, 0, 3.5, 7, 10.5]) slots.push({ pos: v(ox + lx, oz + lz), via: [laneHead] });
  }
  return slots;
}

export const ZONES = Object.freeze({
  'Residence Wing': { node: 'residenceDoor', indoor: true },
  'Main House': { node: 'houseDoor', indoor: true },
  'Dining Hall': { node: 'diningDoor', indoor: true },
  'Wellness Pavilion': { node: 'pavilionDoor', indoor: false, slots: pavilionSlots() },
  Gardens: { node: 'gardensEntry', indoor: false, slots: gardenSlots() },
  // Courtyard has no single door: each slot uses the nearest ring node.
  Courtyard: { node: null, indoor: false, slots: courtyardSlots() },
});

export class NavGraph {
  constructor() {
    this.nodes = NODES;
    this.adj = new Map(Object.keys(NODES).map((k) => [k, []]));
    for (const [a, b] of EDGES) {
      const d = NODES[a].distanceTo(NODES[b]);
      this.adj.get(a).push({ to: b, d });
      this.adj.get(b).push({ to: a, d });
    }
    this._routeCache = new Map();
    this._occupied = new Map(Object.keys(ZONES).map((z) => [z, new Set()]));
  }

  /** Shortest node path (Dijkstra; the graph is tiny so this is cheap and cached). */
  nodeRoute(from, to) {
    const key = `${from}>${to}`;
    if (this._routeCache.has(key)) return this._routeCache.get(key);
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = new Set([from]);
    while (open.size) {
      let cur = null;
      for (const n of open) if (cur === null || dist.get(n) < dist.get(cur)) cur = n;
      open.delete(cur);
      if (cur === to) break;
      for (const { to: nb, d } of this.adj.get(cur)) {
        const nd = dist.get(cur) + d;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          prev.set(nb, cur);
          open.add(nb);
        }
      }
    }
    const path = [to];
    while (path[0] !== from) {
      const p = prev.get(path[0]);
      if (!p) throw new Error(`NavGraph: no route ${from} → ${to}`);
      path.unshift(p);
    }
    this._routeCache.set(key, path);
    return path;
  }

  /** Node a slot connects through (courtyard slots use the nearest ring node). */
  _nodeFor(zoneName, slot) {
    const zone = ZONES[zoneName];
    if (zone.node) return zone.node;
    let best = null;
    for (const n of ['plazaN', 'plazaE', 'plazaS', 'plazaW']) {
      if (!best || NODES[n].distanceToSquared(slot.pos) < NODES[best].distanceToSquared(slot.pos)) best = n;
    }
    return best;
  }

  /** Reserve a free slot in an outdoor zone (or null for indoor zones). */
  claimSlot(zoneName, rng) {
    const zone = ZONES[zoneName];
    if (zone.indoor) return null;
    const taken = this._occupied.get(zoneName);
    const free = zone.slots.map((_, i) => i).filter((i) => !taken.has(i));
    const index = free.length ? rng.pick(free) : rng.int(0, zone.slots.length - 1); // overflow: share
    taken.add(index);
    return { index, ...zone.slots[index] };
  }

  releaseSlot(zoneName, slot) {
    if (slot) this._occupied.get(zoneName)?.delete(slot.index);
  }

  /**
   * Full world-space path between two placements.
   * A placement is { zone, slot } where slot is null for indoor zones.
   */
  buildPath(from, to) {
    const pts = [];
    if (from.slot) pts.push(...[...from.slot.via].reverse());
    const a = this._nodeFor(from.zone, from.slot);
    const b = this._nodeFor(to.zone, to.slot);
    for (const n of this.nodeRoute(a, b)) pts.push(NODES[n]);
    if (to.slot) pts.push(...to.slot.via, to.slot.pos);
    return pts.map((p) => p.clone());
  }

  /** World position a resident stands at when placed (door for indoor zones). */
  placementPosition({ zone, slot }) {
    return (slot ? slot.pos : NODES[ZONES[zone].node]).clone();
  }

  static pathLength(points, start) {
    let len = 0;
    let prev = start;
    for (const p of points) {
      len += prev.distanceTo(p);
      prev = p;
    }
    return len;
  }
}
