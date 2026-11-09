import { bus, Events } from '../core/EventBus.js';
import { Random } from '../core/Random.js';
import { NavGraph, ZONES } from '../world/NavGraph.js';
import { SubjectFactory, ANIM } from './SubjectFactory.js';
import { MINUTES_PER_DAY } from './SimClock.js';

const hm = (h, m = 0) => h * 60 + m;

/**
 * Needs run 0–100 where 100 is fully satisfied. Every need drains at a base
 * rate per game minute (slower while resting); activities add on top.
 * Tuned so a typical resident settles around 60–80 rather than saturating.
 */
const BASE_DRAIN = { energy: -0.05, hunger: -0.08, social: -0.05, calm: -0.06 };
const REST_DRAIN_SCALE = 0.3;
const ACTIVITY_EFFECTS = {
  rest: { energy: +0.24, hunger: 0, social: 0, calm: +0.03 },
  meal: { energy: +0.02, hunger: +1.6, social: +0.15, calm: +0.03 },
  session: { energy: -0.03, hunger: 0, social: +0.04, calm: +0.12 },
  work: { energy: -0.06, hunger: -0.02, social: +0.06, calm: +0.04 },
  leisure: { energy: +0.02, hunger: 0, social: +0.12, calm: +0.05 },
  walking: { energy: -0.03, hunger: -0.01, social: 0, calm: 0 },
};
/** Social gain multiplier for time spent alone in the dormitory. */
const PRIVATE_SOCIAL_SCALE = 0.2;

/** Composure change when attendance is recorded for a mandatory block. */
const ATTENDANCE_COMPOSURE = { onTime: +0.6, late: -2, missed: -5 };

/** Minutes after block start that still count as late rather than missed. */
const LATE_GRACE = 15;

/**
 * Daily timetable. `zone` is a zone name, or a function(resident) for
 * blocks where residents choose where to spend their time.
 */
export const TIMETABLE = Object.freeze([
  { id: 'night', label: 'Rest', start: hm(0), end: hm(6), zone: 'Residence Wing', kind: 'rest' },
  { id: 'rise', label: 'Rise & Prepare', start: hm(6), end: hm(6, 45), zone: 'Residence Wing', kind: 'rest' },
  { id: 'breakfast', label: 'Breakfast', start: hm(7), end: hm(7, 45), zone: 'Dining Hall', kind: 'meal', mandatory: true },
  { id: 'am-session', label: 'Morning Session', start: hm(8), end: hm(10), zone: 'Wellness Pavilion', kind: 'session', mandatory: true },
  { id: 'garden-duty', label: 'Garden Duty', start: hm(10, 15), end: hm(12), zone: 'Gardens', kind: 'work', mandatory: true },
  { id: 'lunch', label: 'Lunch', start: hm(12, 15), end: hm(13), zone: 'Dining Hall', kind: 'meal', mandatory: true },
  {
    id: 'free-time', label: 'Free Time', start: hm(13, 10), end: hm(14, 30), kind: 'leisure',
    zone: (r, rng) => (rng.chance(0.25 + r.traits.sociability * 0.6) ? 'Courtyard' : 'Residence Wing'),
  },
  { id: 'pm-session', label: 'Afternoon Session', start: hm(14, 40), end: hm(16, 30), zone: 'Wellness Pavilion', kind: 'session', mandatory: true },
  {
    id: 'leisure', label: 'Leisure', start: hm(16, 45), end: hm(18), kind: 'leisure',
    zone: (r, rng) => rng.weighted([
      { value: 'Courtyard', weight: 0.3 + r.traits.sociability },
      { value: 'Gardens', weight: 0.6 },
      { value: 'Residence Wing', weight: 1.2 - r.traits.sociability },
    ]),
  },
  { id: 'dinner', label: 'Dinner', start: hm(18, 15), end: hm(19), zone: 'Dining Hall', kind: 'meal', mandatory: true },
  {
    id: 'evening', label: 'Evening Leisure', start: hm(19, 10), end: hm(21, 30), kind: 'leisure',
    zone: (r, rng) => (rng.chance(0.2 + r.traits.sociability * 0.5) ? 'Courtyard' : 'Residence Wing'),
  },
  { id: 'curfew', label: 'Curfew', start: hm(21, 45), end: hm(24), zone: 'Residence Wing', kind: 'rest', mandatory: true },
]);

/**
 * ScheduleSystem — runs the timetable against the resident roster.
 *
 * Per day it plans, for every resident and block, where they will go and
 * when they set off (punctual residents leave early, others cut it fine).
 * Attendance is judged on arrival: on time, late (within the grace window)
 * or missed. Needs drift with the current activity and composure follows
 * how well needs are met, plus attendance outcomes.
 */
export class ScheduleSystem {
  constructor({ residents, scene, clock, seed = 'sanctuary-alpha' }) {
    this.residents = residents;
    this.byId = new Map(residents.map((r) => [r.id, r]));
    this.clock = clock;
    this.nav = new NavGraph();
    this.seed = seed;
    this.today = { onTime: 0, late: 0, missed: 0 };

    for (const r of residents) {
      r.position.copy(this.nav.placementPosition(r.placement));
      scene.add(r.mesh);
    }

    this._planDay(clock.day);
    this._syncInitialBlock();

    this._off = [
      bus.on(Events.CLOCK_MINUTE, (e) => this._onMinute(e)),
      bus.on(Events.CLOCK_DAY, ({ day }) => this._onNewDay(day)),
    ];
    bus.emit(Events.RESIDENTS_SPAWNED, { residents });
    this._emitStats();
  }

  /** Block active at a minute of day, or null during transitions. */
  static blockAt(minuteOfDay) {
    return TIMETABLE.find((b) => minuteOfDay >= b.start && minuteOfDay < b.end) ?? null;
  }

  /** Next block starting strictly after `minuteOfDay` (wraps to tomorrow's first). */
  static nextBlock(minuteOfDay) {
    return TIMETABLE.find((b) => b.start > minuteOfDay) ?? TIMETABLE[0];
  }

  // ---------------------------------------------------------------- planning
  _planDay(day) {
    for (const r of this.residents) {
      const rng = new Random(`${this.seed}:${r.id}:day${day}`);
      r.plan = {};
      for (const b of TIMETABLE) {
        const zone = typeof b.zone === 'function' ? b.zone(r, rng) : b.zone;
        // Minutes of slack before the block starts; negative ⇒ sets off late.
        const slack = -4 + r.traits.punctuality * 16 + rng.gaussian(0, 3);
        r.plan[b.id] = { zone, slack };
      }
      r.today = {};
    }
    this.today = { onTime: 0, late: 0, missed: 0 };
  }

  /** On load, put everyone straight into whatever block is running. */
  _syncInitialBlock() {
    const block = ScheduleSystem.blockAt(this.clock.minuteOfDay);
    if (!block) return;
    for (const r of this.residents) {
      const zone = r.plan[block.id].zone;
      this._place(r, { zone, slot: this.nav.claimSlot(zone, this._rng(r)) });
      r.blockId = block.id;
    }
  }

  _rng(r) {
    return new Random(`${this.seed}:${r.id}:${this.clock.total | 0}`);
  }

  // ------------------------------------------------------------- clock hooks
  _onMinute({ minuteOfDay, day }) {
    // Minute 0 closes yesterday's blocks that end at midnight.
    const endMinute = minuteOfDay === 0 ? MINUTES_PER_DAY : minuteOfDay;
    for (const b of TIMETABLE) {
      if (b.end === endMinute) this._closeBlock(b, minuteOfDay === 0 ? day - 1 : day);
      if (b.start === minuteOfDay) bus.emit(Events.BLOCK_START, { block: b, day });
    }
    for (const r of this.residents) this._maybeDepart(r, minuteOfDay);
    if (minuteOfDay % 5 === 0) this._emitStats();
  }

  _onNewDay(day) {
    this._planDay(day);
  }

  _closeBlock(block, day) {
    if (block.mandatory) {
      for (const r of this.residents) if (!r.today[block.id]) this._recordAttendance(r, block, 'missed');
    }
    bus.emit(Events.BLOCK_END, { block, day, summary: { ...this.today } });
  }

  /** Decide whether a resident should set off for their current/next block. */
  _maybeDepart(r, now) {
    const current = ScheduleSystem.blockAt(now);
    let target = null;

    // Already heading to a block that starts soon (left the current one early)?
    const assigned = r.blockId && TIMETABLE.find((b) => b.id === r.blockId);
    const movedOn = assigned && assigned.start > now && assigned.start - now < 120;

    if (current && r.blockId !== current.id) {
      if (!movedOn) target = current; // running late for a block already in progress
    } else {
      const next = ScheduleSystem.nextBlock(now);
      if (next.start <= now || next.id === r.blockId) return; // wrapped to tomorrow or already there
      const plan = r.plan[next.id];
      const from = this.nav.placementPosition(r.placement);
      const travel = NavGraph.pathLength(this._previewPath(r, plan.zone), from) / r.walkSpeed;
      if (now >= next.start - travel - plan.slack) target = next;
    }
    if (target) this._sendTo(r, target);
  }

  _previewPath(r, zone) {
    // Use the zone node as a stand-in destination for travel-time estimates.
    return this.nav.buildPath(r.placement, { zone, slot: ZONES[zone].slots?.[0] ?? null });
  }

  _sendTo(r, block) {
    const zone = r.plan[block.id].zone;
    r.blockId = block.id;

    if (zone === r.placement.zone) {
      // Already in the right place: attendance counts immediately.
      this._arrive(r, block);
      return;
    }

    const slot = this.nav.claimSlot(zone, this._rng(r));
    const to = { zone, slot };
    if (r.anim === ANIM.HIDDEN) r.position.copy(this.nav.placementPosition(r.placement)); // step out the door
    // If redirected mid-walk, finish the current leg to the old placement first
    // so the new route still follows the path network.
    r.path = [...r.path, ...this.nav.buildPath(r.placement, to)];
    this.nav.releaseSlot(r.placement.zone, r.placement.slot);
    r.placement = to;
    r.anim = ANIM.WALK;
    r.arrived = false;
  }

  _arrive(r, block) {
    r.path = [];
    r.arrived = true;
    const zone = ZONES[r.placement.zone];
    if (zone.indoor) r.anim = ANIM.HIDDEN;
    else r.anim = block.kind === 'session' || block.kind === 'meal' ? ANIM.SEATED : ANIM.IDLE;

    // Face the zone's focal point when standing in it.
    if (!zone.indoor && r.placement.slot) {
      const focus = r.placement.zone === 'Wellness Pavilion' ? { x: 28, z: -6 } : r.placement.zone === 'Courtyard' ? { x: 0, z: 8 } : null;
      if (focus) r.heading = Math.atan2(focus.x - r.position.x, focus.z - r.position.z);
    }

    if (block.mandatory && !r.today[block.id]) {
      const lateBy = Math.floor(this.clock.minuteOfDay) - block.start; // whole minutes
      const status = lateBy <= 0 ? 'onTime' : lateBy <= LATE_GRACE ? 'late' : 'missed';
      this._recordAttendance(r, block, status);
    }
  }

  _recordAttendance(r, block, status) {
    r.today[block.id] = status;
    r.record[status]++;
    this.today[status]++;
    r.composure += ATTENDANCE_COMPOSURE[status];
    bus.emit(Events.ATTENDANCE, { resident: r, block, status });
  }

  _place(r, placement) {
    r.placement = placement;
    r.position.copy(this.nav.placementPosition(placement));
    r.path = [];
    r.arrived = true;
    r.anim = ZONES[placement.zone].indoor ? ANIM.HIDDEN : ANIM.IDLE;
  }

  // -------------------------------------------------------------- per frame
  /** @param {number} dtGame game minutes elapsed this frame */
  update(dtGame) {
    if (dtGame <= 0) {
      for (const r of this.residents) SubjectFactory.syncMesh(r, 0);
      return;
    }
    const now = this.clock.minuteOfDay;
    const block = ScheduleSystem.blockAt(now);

    for (const r of this.residents) {
      if (r.path.length) this._walk(r, dtGame);
      this._updateNeeds(r, dtGame, block);
      SubjectFactory.syncMesh(r, dtGame);
    }
  }

  _walk(r, dtGame) {
    let budget = r.walkSpeed * dtGame;
    while (budget > 0 && r.path.length) {
      const target = r.path[0];
      const dx = target.x - r.position.x;
      const dz = target.z - r.position.z;
      const dist = Math.hypot(dx, dz, target.y - r.position.y);
      if (dist > 1e-3) r.heading = Math.atan2(dx, dz);
      if (dist <= budget) {
        r.position.copy(target);
        r.path.shift();
        budget -= dist;
      } else {
        r.position.lerp(target, budget / dist);
        budget = 0;
      }
    }
    if (!r.path.length) {
      const block = TIMETABLE.find((b) => b.id === r.blockId);
      this._arrive(r, block);
    }
  }

  _updateNeeds(r, dtGame, block) {
    const walking = r.path.length > 0;
    const attending = !walking && block && r.blockId === block.id;
    const kind = walking ? 'walking' : attending ? block.kind : 'leisure';
    const fx = ACTIVITY_EFFECTS[kind];
    const drain = kind === 'rest' ? REST_DRAIN_SCALE : 1;
    const stamina = 1.25 - r.traits.stamina * 0.5; // low stamina tires faster
    const alone = !walking && r.placement.zone === 'Residence Wing' ? PRIVATE_SOCIAL_SCALE : 1;

    r.needs.energy += (BASE_DRAIN.energy * drain * stamina + fx.energy) * dtGame;
    r.needs.hunger += (BASE_DRAIN.hunger * drain + fx.hunger) * dtGame;
    r.needs.social += (BASE_DRAIN.social * drain + fx.social * alone * (0.5 + r.traits.sociability)) * dtGame;
    r.needs.calm += (BASE_DRAIN.calm * drain + fx.calm) * dtGame;

    // Composure eases toward how well needs are met; steadier temperaments move slower.
    const n = r.needs;
    const wellbeing = n.energy * 0.3 + n.hunger * 0.25 + n.social * 0.2 + n.calm * 0.25;
    const rate = 0.004 + (1 - r.traits.temperament) * 0.01;
    r.composure += (wellbeing - r.composure) * rate * dtGame;

    SubjectFactory.clampNeeds(r);
  }

  // ------------------------------------------------------------------ stats
  stats() {
    const pop = this.residents.length;
    const avg = (fn) => this.residents.reduce((s, r) => s + fn(r), 0) / Math.max(1, pop);
    return {
      population: pop,
      avgComposure: avg((r) => r.composure),
      avgNeeds: {
        energy: avg((r) => r.needs.energy),
        hunger: avg((r) => r.needs.hunger),
        social: avg((r) => r.needs.social),
        calm: avg((r) => r.needs.calm),
      },
      walking: this.residents.filter((r) => r.path.length).length,
      today: { ...this.today },
      block: ScheduleSystem.blockAt(this.clock.minuteOfDay),
      next: ScheduleSystem.nextBlock(this.clock.minuteOfDay),
    };
  }

  _emitStats() {
    bus.emit(Events.FACILITY_STATS, this.stats());
  }

  dispose() {
    this._off.forEach((off) => off());
  }
}
