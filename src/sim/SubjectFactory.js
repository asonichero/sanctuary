import * as THREE from 'three';
import { Random } from '../core/Random.js';

/**
 * SubjectFactory — procedural resident generation.
 *
 * A resident is a plain data record (identity, traits, needs, composure,
 * attendance history, movement state) plus a low-poly mesh. Systems mutate
 * the record; `syncMesh` pushes the visible state onto the mesh each frame.
 */

const FIRST_NAMES = [
  'Ada', 'Bram', 'Celia', 'Dorian', 'Elise', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonah',
  'Kira', 'Leon', 'Mara', 'Nico', 'Odile', 'Pascal', 'Quinn', 'Rosa', 'Silas', 'Tess',
  'Ulric', 'Vera', 'Wren', 'Xavi', 'Yara', 'Zane', 'Alba', 'Cyrus', 'Delphine', 'Emil',
];
const LAST_NAMES = [
  'Ashdown', 'Bellweather', 'Calloway', 'Dunmore', 'Everly', 'Fairhurst', 'Garrow', 'Hartwell',
  'Ingram', 'Jessop', 'Kestrel', 'Lockwood', 'Marlowe', 'Northcott', 'Oakley', 'Penhallow',
  'Quarles', 'Ravenscroft', 'Sutherby', 'Thorne', 'Underhill', 'Vane', 'Whitlock', 'Yardley',
];

/** Residents are grouped into cohorts that share a tunic colour and dormitory floor. */
export const COHORTS = Object.freeze([
  { id: 'linden', name: 'Linden', color: 0x6f8fa8 },
  { id: 'cedar', name: 'Cedar', color: 0xa8746f },
  { id: 'birch', name: 'Birch', color: 0x8fa86f },
]);

const SKIN_TONES = [0xf1d3b8, 0xe0b48f, 0xc68d65, 0x9c6a47, 0x6e4a33, 0xf5dcc8];
const HAIR_TONES = [0x2b2118, 0x4a3324, 0x7a5a3a, 0xb08a5a, 0x1c1c1c, 0x9a9a9a];

export const ANIM = Object.freeze({ IDLE: 'idle', WALK: 'walk', SEATED: 'seated', HIDDEN: 'hidden' });

// Shared geometry: every resident reuses these buffers.
const GEO = {
  body: new THREE.CapsuleGeometry(0.42, 0.9, 3, 8).translate(0, 0.87, 0),
  head: new THREE.IcosahedronGeometry(0.34, 1).translate(0, 1.92, 0),
  hair: new THREE.IcosahedronGeometry(0.36, 0).translate(0, 2.02, -0.04),
  ring: new THREE.RingGeometry(0.55, 0.7, 16).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
};
const materialCache = new Map();
const mat = (color) => {
  if (!materialCache.has(color)) {
    materialCache.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 }));
  }
  return materialCache.get(color);
};

const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

export class SubjectFactory {
  /**
   * @param {object} opts
   * @param {number|string} opts.seed  same seed ⇒ same roster
   */
  constructor({ seed = 'sanctuary-alpha' } = {}) {
    this.rng = new Random(seed);
    this._serial = 0;
    this._usedNames = new Set();
  }

  /** Create `count` residents spread evenly across cohorts. */
  createRoster(count) {
    return Array.from({ length: count }, (_, i) => this.create({ cohort: COHORTS[i % COHORTS.length] }));
  }

  create({ cohort } = {}) {
    const rng = this.rng.fork(`resident-${this._serial}`);
    const serial = ++this._serial;
    cohort ??= rng.pick(COHORTS);

    const traits = {
      punctuality: rng.trait(0.6), // how early they leave for scheduled blocks
      sociability: rng.trait(0.5), // preference for shared spaces in free time
      stamina: rng.trait(0.55), // walking speed and energy drain
      temperament: rng.trait(0.5), // how quickly composure reacts to needs (higher = steadier)
    };

    const resident = {
      id: `R-${String(serial).padStart(3, '0')}`,
      name: this._uniqueName(rng),
      age: rng.int(23, 58),
      cohort: cohort.id,
      room: `${cohort.name} ${rng.int(1, 3)}${String(rng.int(1, 12)).padStart(2, '0')}`,
      traits,
      needs: {
        energy: rng.range(70, 95),
        hunger: rng.range(45, 70), // 100 = fully fed
        social: rng.range(40, 80),
        calm: rng.range(50, 85),
      },
      composure: rng.range(55, 80),
      record: { onTime: 0, late: 0, missed: 0 },
      today: {}, // blockId -> 'onTime' | 'late' | 'missed'

      // Movement / placement (owned by ScheduleSystem)
      placement: { zone: 'Residence Wing', slot: null },
      blockId: null,
      path: [],
      walkSpeed: 11 + traits.stamina * 5, // world units per game minute
      anim: ANIM.HIDDEN,
      position: new THREE.Vector3(),
      heading: rng.range(0, Math.PI * 2),
      _phase: rng.range(0, Math.PI * 2),

      appearance: {
        skin: rng.pick(SKIN_TONES),
        hair: rng.pick(HAIR_TONES),
        tunic: cohort.color,
        height: rng.range(0.92, 1.08),
      },
    };
    resident.mesh = this.buildMesh(resident);
    return resident;
  }

  _uniqueName(rng) {
    for (let tries = 0; tries < 50; tries++) {
      const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!this._usedNames.has(name)) {
        this._usedNames.add(name);
        return name;
      }
    }
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${this._serial}`;
  }

  buildMesh(resident) {
    const { skin, hair, tunic, height } = resident.appearance;
    const root = new THREE.Group();
    root.scale.setScalar(1.25); // readable at management-camera distances
    root.name = resident.id;
    root.userData.residentId = resident.id;

    const figure = new THREE.Group(); // animated part; root stays on the ground
    figure.scale.setScalar(height);
    const body = new THREE.Mesh(GEO.body, mat(tunic));
    const head = new THREE.Mesh(GEO.head, mat(skin));
    const hairMesh = new THREE.Mesh(GEO.hair, mat(hair));
    for (const m of [body, head, hairMesh]) m.castShadow = true;
    figure.add(body, head, hairMesh);

    // Ground ring tinted by composure (management-sim status read-out).
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
    const ring = new THREE.Mesh(GEO.ring, ringMat);

    root.add(figure, ring);
    root.userData.parts = { figure, ring, ringMat };
    root.visible = false;
    return root;
  }

  /** Push data-record state onto the mesh. Call once per frame. */
  static syncMesh(resident, dtGame) {
    const { mesh, position, anim } = resident;
    const { figure, ringMat } = mesh.userData.parts;
    mesh.visible = anim !== ANIM.HIDDEN;
    if (!mesh.visible) return;

    mesh.position.copy(position);
    // Smoothly turn toward heading.
    const diff = Math.atan2(Math.sin(resident.heading - mesh.rotation.y), Math.cos(resident.heading - mesh.rotation.y));
    mesh.rotation.y += diff * Math.min(1, dtGame * 6);

    resident._phase += dtGame * (anim === ANIM.WALK ? 9 : 1.2);
    if (anim === ANIM.WALK) {
      figure.position.y = Math.abs(Math.sin(resident._phase)) * 0.12;
      figure.rotation.z = Math.sin(resident._phase) * 0.06;
      figure.scale.y = resident.appearance.height;
    } else if (anim === ANIM.SEATED) {
      figure.position.y = -0.35;
      figure.rotation.z = 0;
      figure.scale.y = resident.appearance.height * 0.92;
    } else {
      // idle breathing
      figure.position.y = 0;
      figure.rotation.z = 0;
      figure.scale.y = resident.appearance.height * (1 + Math.sin(resident._phase) * 0.012);
    }

    ringMat.color.setHSL((clamp(resident.composure) / 100) * 0.33, 0.55, 0.5); // red → green
  }

  static clampNeeds(resident) {
    for (const k of Object.keys(resident.needs)) resident.needs[k] = clamp(resident.needs[k]);
    resident.composure = clamp(resident.composure);
  }
}
