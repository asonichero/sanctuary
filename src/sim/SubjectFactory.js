import * as THREE from 'three';
import { Random } from '../core/Random.js';
import {
  ROLES, TIERS, TRAITS, STATES, STARTING_STATS, NEWCOMER_SHARE, FIRST_NAMES, LAST_NAMES, SKIN_TONES,
} from '../content/roster.js';
import { BANDS } from '../content/composure.js';
import { bandOf } from './composureRules.js';

/**
 * SubjectFactory — procedural residents and staff.
 *
 * Every agent is a low-poly athletic mannequin (tank top, compression shorts
 * or leggings, trainers) in its tier's colours: SLATE newcomers, OCHRE
 * intermediates, CHARCOAL staff.
 *
 * Core state lives on `mesh.userData` as plain JSON (the same object as
 * `agent.sim`):
 *   { id, role, tier, trait, stats: { composure, fatigue, defiance }, state, assignedSocket }
 * Runtime-only fields (position, path, plan, rig) stay on the agent record so
 * userData stays cloneable and serialisable.
 */

export const ANIM = Object.freeze({
  IDLE: 'idle', WALK: 'walk', HIDDEN: 'hidden',
  STAND: 'stand', // lineup / assembly: at attention
  HOLD: 'hold', // static hold on a mat: arms out
  RAKE: 'rake', // groundskeeping
  SUPERVISE: 'supervise', // staff at a post: hands behind back
  SEATED: 'seated', // on the edge of their bed
  STRETCH: 'stretch', // player-granted stretch break: arms overhead
});

// Shared geometry (local units; the root is scaled for camera distance).
const GEO = {
  pelvis: new THREE.CylinderGeometry(0.19, 0.21, 0.24, 6).translate(0, -0.06, 0).scale(1, 1, 0.75),
  thigh: new THREE.CylinderGeometry(0.105, 0.085, 0.5, 6).translate(0, -0.25, 0),
  shin: new THREE.CylinderGeometry(0.08, 0.055, 0.46, 6).translate(0, -0.23, 0),
  shoe: new THREE.BoxGeometry(0.12, 0.08, 0.26).translate(0, -0.5, 0.05),
  torso: new THREE.CylinderGeometry(0.27, 0.2, 0.62, 6).translate(0, 0.31, 0).scale(1, 1, 0.68),
  neck: new THREE.CylinderGeometry(0.065, 0.075, 0.14, 5).translate(0, 0.68, 0),
  head: new THREE.IcosahedronGeometry(0.16, 1).scale(0.92, 1.08, 1).translate(0, 0.88, 0),
  upperArm: new THREE.CylinderGeometry(0.06, 0.052, 0.32, 5).translate(0, -0.16, 0),
  forearm: new THREE.CylinderGeometry(0.05, 0.042, 0.29, 5).translate(0, -0.145, 0),
  hand: new THREE.IcosahedronGeometry(0.05, 0).translate(0, -0.32, 0),
  rakeHandle: new THREE.CylinderGeometry(0.018, 0.018, 1.5, 4).translate(0, -0.4, 0),
  rakeHead: new THREE.BoxGeometry(0.42, 0.05, 0.06).translate(0, -1.15, 0),
  ring: new THREE.RingGeometry(0.5, 0.72, 20).rotateX(-Math.PI / 2).translate(0, 0.05, 0),
};
const materialCache = new Map();
const mat = (color) => {
  if (!materialCache.has(color)) {
    materialCache.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 }));
  }
  return materialCache.get(color);
};
const BAND_COLORS = Object.fromEntries(Object.values(BANDS).map((b) => [b.id, new THREE.Color(b.color)]));

const randIn = (rng, [lo, hi]) => rng.range(lo, hi);

export class SubjectFactory {
  /** @param {{ seed?: number|string }} opts  same seed ⇒ same roster */
  constructor({ seed = 'sanctuary-alpha' } = {}) {
    this.rng = new Random(seed);
    this._serial = { RESIDENT: 0, STAFF: 0 };
    this._usedNames = new Set();
  }

  /** `count` residents with an even spread of traits and ~60% newcomers. */
  createResidents(count) {
    const traitIds = Object.keys(TRAITS);
    const newcomers = Math.round(count * NEWCOMER_SHARE);
    const order = this.rng.fork('roster').shuffle([...Array(count).keys()]);
    return Array.from({ length: count }, (_, i) =>
      this.create({
        role: ROLES.RESIDENT,
        trait: traitIds[i % traitIds.length],
        tier: order[i] < newcomers ? 'SLATE' : 'OCHRE',
      }),
    );
  }

  createStaff(count) {
    return Array.from({ length: count }, () => this.create({ role: ROLES.STAFF }));
  }

  create({ role = ROLES.RESIDENT, tier, trait } = {}) {
    const staff = role === ROLES.STAFF;
    const serial = ++this._serial[role];
    const id = `${staff ? 'stf' : 'res'}_${String(serial).padStart(3, '0')}`;
    const rng = this.rng.fork(id);
    tier = staff ? 'CHARCOAL' : tier ?? (rng.chance(NEWCOMER_SHARE) ? 'SLATE' : 'OCHRE');
    trait ??= staff ? 'OVERACHIEVER' : rng.pick(Object.keys(TRAITS));

    const range = STARTING_STATS[tier];
    /** Spec'd core state — this exact object becomes mesh.userData. */
    const sim = {
      id,
      role,
      tier,
      trait,
      stats: {
        composure: Math.round(randIn(rng, range.composure)),
        fatigue: Math.round(randIn(rng, range.fatigue)),
        defiance: Math.round(randIn(rng, range.defiance)),
      },
      state: STATES.SCHEDULED_TASK,
      assignedSocket: null,
    };

    const agent = {
      id,
      sim,
      name: this._uniqueName(rng),
      // Hidden per-agent variation (kept off userData).
      punctuality: staff ? 1 : Math.min(1, Math.max(0, TRAITS[trait].punctuality + rng.gaussian(0, 0.12))),
      steadiness: staff ? 1 : rng.range(0.85, 1.15), // personal scale on composure loss
      band: bandOf(sim.stats.composure),
      activity: 'rest',
      cooldowns: {}, // player action id -> game minute last used
      attention: null, // { x, z, until } — turns to face the player briefly

      // Movement / placement (owned by ScheduleSystem)
      placement: { zone: staff ? 'Main House' : 'Residence Wing', slot: null },
      blockId: null,
      path: [],
      walkSpeed: staff ? 14 : 11 + rng.range(0, 5), // world units per game minute
      anim: ANIM.HIDDEN,
      position: new THREE.Vector3(),
      heading: rng.range(0, Math.PI * 2),
      _phase: rng.range(0, Math.PI * 2),

      appearance: {
        skin: rng.pick(SKIN_TONES),
        legwear: staff || rng.chance(0.5) ? 'leggings' : 'shorts',
        height: rng.range(0.94, 1.06) * (staff ? 1.03 : 1),
        build: rng.range(0.92, 1.1), // shoulder/hip width
      },
    };
    this.buildMesh(agent);
    return agent;
  }

  _uniqueName(rng) {
    for (let tries = 0; tries < 50; tries++) {
      const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!this._usedNames.has(name)) {
        this._usedNames.add(name);
        return name;
      }
    }
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${this._usedNames.size}`;
  }

  /** Build the jointed mannequin. Sets `agent.mesh` and `agent.rig`. */
  buildMesh(agent) {
    const { skin, legwear, height, build } = agent.appearance;
    const kit = TIERS[agent.sim.tier];
    const part = (geo, color, parent) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const group = (parent, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    const root = new THREE.Group();
    root.scale.setScalar(1.25); // readable at management-camera distances
    root.name = agent.id;
    root.userData = agent.sim;

    const figure = group(root); // bob / sway; root stays on the ground
    figure.scale.set(build, height, build);

    // Hips and legs (hip pivot 1.0 above the ground).
    const hips = group(figure, 0, 1.0, 0);
    part(GEO.pelvis, kit.lower, hips);
    const legs = [-1, 1].map((side) => {
      const hip = group(hips, side * 0.11, -0.08, 0);
      part(GEO.thigh, kit.lower, hip);
      const knee = group(hip, 0, -0.5, 0);
      part(GEO.shin, legwear === 'leggings' ? kit.lower : skin, knee);
      part(GEO.shoe, kit.trim, knee);
      return { hip, knee };
    });

    // Spine (waist pivot) carries torso, head and arms so slouching moves them together.
    const spine = group(figure, 0, 1.0, 0);
    part(GEO.torso, kit.top, spine);
    part(GEO.neck, skin, spine);
    const neck = group(spine, 0, 0.66, 0);
    const head = part(GEO.head, skin, neck);
    head.position.y = -0.66; // geometry is authored in spine space
    const arms = [-1, 1].map((side) => {
      const shoulder = group(spine, side * 0.31, 0.58, 0);
      part(GEO.upperArm, skin, shoulder);
      const elbow = group(shoulder, 0, -0.32, 0);
      part(GEO.forearm, skin, elbow);
      part(GEO.hand, skin, elbow);
      return { shoulder, elbow, side };
    });

    // Rake (groundskeeping only), held in the right hand.
    const rake = group(arms[0].elbow, 0, -0.3, 0);
    part(GEO.rakeHandle, 0x8a6a48, rake);
    part(GEO.rakeHead, 0x5d5f61, rake);
    rake.visible = false;

    // Aura ring: Cool Blue / Amber / Red (flashing). Staff have none.
    const ringMat = new THREE.MeshBasicMaterial({
      color: BAND_COLORS[agent.band], transparent: true, opacity: 0.8, depthWrite: false,
    });
    const ring = new THREE.Mesh(GEO.ring, ringMat);
    ring.raycast = () => {}; // the crosshair targets the body, not the floor ring
    ring.visible = agent.sim.role === ROLES.RESIDENT;
    root.add(ring);

    root.visible = false;
    agent.mesh = root;
    agent.rig = { figure, hips, spine, neck, legs, arms, rake, ring, ringMat };
    return root;
  }

  /**
   * Push record state onto the mesh: placement, animation, posture drift and
   * aura. Call once per frame for every agent.
   * @param {object} agent
   * @param {{ dtGame:number, dtReal:number, time:number }} t  time = real seconds (for flashing while paused)
   */
  static syncMesh(agent, { dtGame, dtReal, time }) {
    const { mesh, position, anim, rig, sim } = agent;
    mesh.visible = anim !== ANIM.HIDDEN;
    if (!mesh.visible) return;

    mesh.position.copy(position);
    // Turn to face the player briefly after an interaction (not while walking).
    let heading = agent.heading;
    const att = agent.attention;
    if (att && time < att.until && anim !== ANIM.WALK && anim !== ANIM.SEATED) {
      heading = Math.atan2(att.x - position.x, att.z - position.z);
    }
    const diff = Math.atan2(Math.sin(heading - mesh.rotation.y), Math.cos(heading - mesh.rotation.y));
    mesh.rotation.y += diff * Math.min(1, Math.max(dtGame * 6, dtReal * 5));

    agent._phase += dtGame * (anim === ANIM.WALK ? 9 : anim === ANIM.RAKE ? 2.2 : 1.2);
    const ph = agent._phase;
    const { composure, fatigue, defiance } = sim.stats;

    // Posture drift: below 70 composure the spine rounds and the head drops.
    // Slouchers show it more; staff hold their line.
    const traitSlump = sim.trait === 'SLOUCHER' ? 1.3 : 1;
    const slump = sim.role === ROLES.STAFF ? 0 : Math.min(1, Math.max(0, (70 - composure) / 70) * traitSlump);
    const tired = fatigue / 100;

    const P = {
      figY: 0, figZ: 0, spineX: slump * 0.42, neckX: slump * 0.35,
      legs: [0, 0], knees: [0, 0],
      arms: [{ x: slump * 0.25, z: 0.1, e: 0 }, { x: slump * 0.25, z: 0.1, e: 0 }],
      rake: false,
    };

    switch (anim) {
      case ANIM.WALK: {
        const s = Math.sin(ph);
        P.figY = Math.abs(s) * 0.06;
        P.legs = [s * 0.5, -s * 0.5];
        P.knees = [Math.max(0, -s) * 0.6, Math.max(0, s) * 0.6];
        P.arms[0].x += -s * 0.45;
        P.arms[1].x += s * 0.45;
        P.arms[0].e = P.arms[1].e = -0.25;
        P.spineX = slump * 0.3 + 0.05;
        break;
      }
      case ANIM.HOLD: {
        // Arms out to the sides; they droop with low composure and shake with fatigue.
        const lift = Math.PI / 2 - slump * 0.8 - tired * 0.25;
        const shake = Math.sin(ph * 9) * tired * 0.06;
        P.arms[0].z = lift + shake;
        P.arms[1].z = lift - shake;
        P.arms[0].x = P.arms[1].x = 0;
        P.legs = [-0.12, 0.12]; // feet apart
        P.spineX = slump * 0.5;
        break;
      }
      case ANIM.RAKE: {
        const s = Math.sin(ph);
        P.spineX = 0.28 + slump * 0.25 + s * 0.06;
        P.arms[0].x = P.arms[1].x = -0.75 + s * 0.3;
        P.arms[0].e = P.arms[1].e = -0.5;
        P.arms[1].z = -0.25;
        P.legs = [0.25, -0.15];
        P.knees = [0.15, 0.05];
        P.rake = true;
        break;
      }
      case ANIM.SEATED: {
        P.figY = -0.52;
        P.legs = [-Math.PI / 2, -Math.PI / 2];
        P.knees = [Math.PI / 2, Math.PI / 2];
        P.arms[0].x = P.arms[1].x = -0.45;
        P.arms[0].e = P.arms[1].e = -0.55;
        P.spineX = 0.08 + slump * 0.35;
        break;
      }
      case ANIM.STRETCH: {
        const s = Math.sin(ph * 0.8);
        P.arms[0].z = P.arms[1].z = Math.PI - 0.3;
        P.arms[0].x = P.arms[1].x = 0;
        P.figZ = s * 0.09;
        P.spineX = -0.06;
        P.neckX = -0.15;
        break;
      }
      case ANIM.SUPERVISE: {
        P.arms[0].x = P.arms[1].x = 0.35;
        P.arms[0].e = P.arms[1].e = -1.3;
        P.arms[0].z = P.arms[1].z = 0.05;
        break;
      }
      case ANIM.STAND:
      default: {
        // At attention; a restless resident shifts weight more the more defiant they are.
        P.figY = Math.sin(ph) * 0.006;
        if (sim.trait === 'RESTLESS') P.figZ = Math.sin(ph * 1.7) * (0.02 + (defiance / 100) * 0.08);
        P.arms[0].z = P.arms[1].z = 0.06;
        break;
      }
    }

    rig.figure.position.y = P.figY;
    rig.figure.rotation.z = P.figZ;
    rig.spine.rotation.x = P.spineX;
    rig.neck.rotation.x = P.neckX;
    rig.legs.forEach((l, i) => {
      l.hip.rotation.x = P.legs[i];
      l.knee.rotation.x = P.knees[i];
    });
    rig.arms.forEach((a, i) => {
      const p = P.arms[i];
      a.shoulder.rotation.set(p.x, 0, a.side * p.z);
      a.elbow.rotation.x = p.e;
    });
    rig.rake.visible = P.rake;
    if (P.rake) rig.rake.rotation.set(0.9, 0, 0.35);

    // Aura: ease toward the band colour; red flashes (in real time, so it reads while paused).
    if (rig.ring.visible) {
      rig.ringMat.color.lerp(BAND_COLORS[agent.band], Math.min(1, dtReal * 6));
      if (agent.band === 'RED') {
        const pulse = 0.5 + 0.5 * Math.sin(time * 7);
        rig.ringMat.opacity = 0.35 + 0.65 * pulse;
        rig.ring.scale.setScalar(1 + pulse * 0.25);
      } else {
        rig.ringMat.opacity = 0.75;
        rig.ring.scale.setScalar(1);
      }
    }
  }
}
