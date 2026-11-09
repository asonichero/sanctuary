import * as THREE from 'three';

/**
 * NavGraph — walkable network for residents and staff.
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
  studioDoor: v(28, 3.4),
  hallEntry: v(28, 16.4),
  gardensEntry: v(-30, 18.5),
  lawn: v(0, 26),
  gate: v(0, 68),
};

const EDGES = [
  // ring around the fountain
  ['plazaN', 'plazaE'], ['plazaE', 'plazaS'], ['plazaS', 'plazaW'], ['plazaW', 'plazaN'],
  ['plazaN', 'houseDoor'],
  ['plazaS', 'lawn'], ['lawn', 'gate'],
  ['plazaE', 'eastJunction'], ['eastJunction', 'studioDoor'], ['eastJunction', 'hallEntry'],
  ['plazaW', 'westJunction'], ['westJunction', 'residenceDoor'], ['westJunction', 'gardensEntry'],
];

/**
 * Slot generators return [{ pos, via: Vector3[] }] — `via` runs from the zone
 * node to the slot. `slots` are residents' sockets, `posts` the staff's.
 */
const slot = (pos, via = []) => ({ pos, via });

/** Alignment Hall: open-sided hall on a low platform; 4 lineup rows of 6 facing the staff line. */
export const HALL = { x: 28, z: 24, floor: 0.3 };
function hallSlots() {
  const slots = [];
  const front = v(HALL.x, 17.8, HALL.floor);
  for (const z of [21.5, 24, 26.5, 29]) {
    for (let c = 0; c < 6; c++) slots.push(slot(v(HALL.x - 6.25 + c * 2.5, z, HALL.floor), [front]));
  }
  return slots;
}
function hallPosts() {
  const front = v(HALL.x, 17.8, HALL.floor);
  return [0, -4, 4].map((dx) => slot(v(HALL.x + dx, 18.8, HALL.floor), [front]));
}

/** Somatic Studio: the domed pavilion, a 5×5 grid of mats with the centre kept for staff. */
export const STUDIO = { x: 28, z: -6, floor: 0.8, spacing: 2.5 };
function studioSlots() {
  const inner = v(28, -0.5, STUDIO.floor);
  const slots = [];
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (r === 0 && c === 0) continue;
      slots.push(slot(v(STUDIO.x + c * STUDIO.spacing, STUDIO.z + r * STUDIO.spacing, STUDIO.floor), [inner]));
    }
  }
  return slots;
}
function studioPosts() {
  const inner = v(28, -0.5, STUDIO.floor);
  return [
    slot(v(STUDIO.x, STUDIO.z, STUDIO.floor), [inner]),
    slot(v(STUDIO.x, STUDIO.z + 7.4, STUDIO.floor), []),
    slot(v(STUDIO.x - 7.4, STUDIO.z, STUDIO.floor), [inner]),
  ];
}

/** Sunken Courtyard: gravel bowl round the fountain; three rings of raking spots. */
export const COURTYARD = { x: 0, z: 8, radius: 10 };
function courtyardSlots() {
  const slots = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = i % 2 ? 5 : 7.5;
    slots.push(slot(v(COURTYARD.x + Math.cos(a) * r, COURTYARD.z + Math.sin(a) * r)));
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2 + 0.2;
    slots.push(slot(v(COURTYARD.x + Math.cos(a) * 9, COURTYARD.z + Math.sin(a) * 9)));
  }
  return slots;
}
function courtyardPosts() {
  return [[0, 1], [1, 0], [-1, 0]].map(([dx, dz]) => slot(v(COURTYARD.x + dx * 10.8, COURTYARD.z + dz * 10.8, 0.35)));
}

/** Assembly Lawn: 4 rows of 6 on the avenue south of the courtyard, facing a low dais. */
export const LAWN = { x: 0, daisZ: 40.5, dais: 0.4 };
function lawnSlots() {
  const slots = [];
  for (const z of [29, 31.5, 34, 36.5]) {
    for (let c = 0; c < 6; c++) slots.push(slot(v(LAWN.x - 6.25 + c * 2.5, z)));
  }
  return slots;
}
function lawnPosts() {
  const step = v(LAWN.x, 38.6);
  return [0, -3, 3].map((dx) => slot(v(LAWN.x + dx, LAWN.daisZ, LAWN.dais), [step]));
}

function gardenSlots() {
  // Hedge beds sit on a 3×3 grid (spacing 7, size 5) centred at (-30, 30);
  // lanes run at local x = ±3.5 and along the north edge at local z = -10.5.
  const ox = -30, oz = 30;
  const slots = [];
  for (const lx of [-10.5, -7, 7, 10.5]) slots.push(slot(v(ox + lx, oz - 10.5)));
  for (const lx of [-3.5, 3.5]) {
    const laneHead = v(ox + lx, oz - 10.5);
    for (const lz of [-7, -3.5, 0, 3.5, 7, 10.5]) slots.push(slot(v(ox + lx, oz + lz), [laneHead]));
  }
  return slots;
}

/**
 * Zones. Indoor zones end at the door (agents are hidden inside). Outdoor
 * zones have resident `slots`, staff `posts`, a `focus` residents face and a
 * `crowd` point staff face.
 */
export const ZONES = Object.freeze({
  'Residence Wing': { node: 'residenceDoor', indoor: true },
  'Main House': { node: 'houseDoor', indoor: true },
  'Alignment Hall': {
    node: 'hallEntry', indoor: false, slots: hallSlots(), posts: hallPosts(),
    focus: v(HALL.x, 18.8), crowd: v(HALL.x, 25),
  },
  'Somatic Studio': {
    node: 'studioDoor', indoor: false, slots: studioSlots(), posts: studioPosts(),
    focus: v(STUDIO.x, STUDIO.z), crowd: v(STUDIO.x, STUDIO.z + 2),
  },
  // The courtyard has no single entry: each slot uses the nearest ring node.
  'Sunken Courtyard': {
    node: null, indoor: false, slots: courtyardSlots(), posts: courtyardPosts(),
    focus: v(COURTYARD.x, COURTYARD.z), crowd: v(COURTYARD.x, COURTYARD.z),
  },
  'Assembly Lawn': {
    node: 'lawn', indoor: false, slots: lawnSlots(), posts: lawnPosts(),
    focus: v(LAWN.x, LAWN.daisZ), crowd: v(LAWN.x, 33),
  },
  Gardens: { node: 'gardensEntry', indoor: false, slots: gardenSlots(), posts: [] },
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
    this._occupied = new Map(); // `${zone}/${kind}` -> Set of taken indices
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

  _taken(zoneName, kind) {
    const key = `${zoneName}/${kind}`;
    if (!this._occupied.has(key)) this._occupied.set(key, new Set());
    return this._occupied.get(key);
  }

  /**
   * Reserve a free socket in an outdoor zone (null for indoor zones).
   * `kind` is 'slots' (residents) or 'posts' (staff). When every socket is
   * taken the agent shares one rather than being turned away.
   */
  claimSlot(zoneName, rng, kind = 'slots') {
    const zone = ZONES[zoneName];
    const list = zone.indoor ? null : zone[kind]?.length ? zone[kind] : zone.slots;
    if (!list) return null;
    const used = list === zone[kind] ? kind : 'slots';
    const taken = this._taken(zoneName, used);
    const free = list.map((_, i) => i).filter((i) => !taken.has(i));
    // Staff take posts in order (head post first); residents scatter.
    const index = free.length ? (used === 'posts' ? free[0] : rng.pick(free)) : rng.int(0, list.length - 1);
    taken.add(index);
    return { index, kind: used, id: `${zoneName}/${used}#${String(index).padStart(2, '0')}`, ...list[index] };
  }

  releaseSlot(zoneName, slot) {
    if (slot) this._taken(zoneName, slot.kind).delete(slot.index);
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
