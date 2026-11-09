import { bus, Events } from '../core/EventBus.js';
import { Random } from '../core/Random.js';
import { NavGraph, ZONES } from '../world/NavGraph.js';
import { ANIM } from './SubjectFactory.js';
import { TIMETABLE, LATE_GRACE, blockAt, nextBlock } from '../content/timetable.js';
import { ROLES } from '../content/roster.js';

/** Animation an agent settles into on arriving for a block, by activity kind. */
const ARRIVE_ANIM = { alignment: ANIM.STAND, hold: ANIM.HOLD, work: ANIM.RAKE, assembly: ANIM.STAND };

/**
 * ScheduleSystem — runs the timetable for residents and staff: zone
 * assignment, socket claiming, waypoint navigation and attendance.
 *
 * Each morning it plans, per agent and block, where they will go and how
 * early they set off (punctual agents leave early; staff always do).
 * Residents take resident sockets, staff take the zone's staff posts.
 * Attendance at mandatory blocks is judged on arrival: on time, late (within
 * the grace window) or missed. Every frame it publishes `agent.activity`
 * ('walking', a block kind, or 'idle') for the composure rules to read.
 *
 * Stats are not touched here; ComposureSystem owns them.
 */
export class ScheduleSystem {
  constructor({ agents, scene, clock, seed = 'sanctuary-alpha' }) {
    this.agents = agents;
    this.residents = agents.filter((a) => a.sim.role === ROLES.RESIDENT);
    this.staff = agents.filter((a) => a.sim.role === ROLES.STAFF);
    this.clock = clock;
    this.nav = new NavGraph();
    this.seed = seed;
    this.today = { onTime: 0, late: 0, missed: 0 };

    for (const a of agents) {
      a.position.copy(this.nav.placementPosition(a.placement));
      scene.add(a.mesh);
    }

    this._planDay(clock.day);
    this._syncInitialBlock();

    this._off = [
      bus.on(Events.CLOCK_MINUTE, (e) => this._onMinute(e)),
      bus.on(Events.CLOCK_DAY, ({ day }) => this._onNewDay(day)),
    ];
    bus.emit(Events.AGENTS_SPAWNED, { agents, residents: this.residents, staff: this.staff });
  }

  static isStaff(a) {
    return a.sim.role === ROLES.STAFF;
  }

  zoneFor(a, block) {
    return ScheduleSystem.isStaff(a) ? block.staffZone ?? block.zone : block.zone;
  }

  // ---------------------------------------------------------------- planning
  _planDay(day) {
    for (const a of this.agents) {
      const rng = new Random(`${this.seed}:${a.id}:day${day}`);
      a.plan = {};
      for (const b of TIMETABLE) {
        // Minutes of slack before the block starts; negative ⇒ sets off late.
        const slack = ScheduleSystem.isStaff(a) ? 10 + rng.range(0, 4) : -4 + a.punctuality * 16 + rng.gaussian(0, 3);
        a.plan[b.id] = { zone: this.zoneFor(a, b), slack };
      }
      a.today = {};
    }
    this.today = { onTime: 0, late: 0, missed: 0 };
  }

  /** On load, put everyone straight into whatever block is running. */
  _syncInitialBlock() {
    const block = blockAt(this.clock.minuteOfDay);
    if (!block) return;
    for (const a of this.agents) {
      const zone = a.plan[block.id].zone;
      this._place(a, { zone, slot: this._claim(a, zone) });
      a.blockId = block.id;
      this._settle(a, block);
    }
  }

  _rng(a) {
    return new Random(`${this.seed}:${a.id}:${this.clock.total | 0}`);
  }

  _claim(a, zone) {
    return this.nav.claimSlot(zone, this._rng(a), ScheduleSystem.isStaff(a) ? 'posts' : 'slots');
  }

  // ------------------------------------------------------------- clock hooks
  _onMinute({ minuteOfDay, day }) {
    for (const b of TIMETABLE) {
      if (b.end === minuteOfDay) this._closeBlock(b, day);
      if (b.start === minuteOfDay) bus.emit(Events.BLOCK_START, { block: b, day });
    }
    for (const a of this.agents) this._maybeDepart(a, minuteOfDay);
  }

  /** A new day opens: everyone wakes at home (stragglers are put to bed). */
  _onNewDay(day) {
    for (const a of this.agents) {
      this.nav.releaseSlot(a.placement.zone, a.placement.slot);
      this._place(a, { zone: ScheduleSystem.isStaff(a) ? 'Main House' : 'Residence Wing', slot: null });
      a.blockId = null;
    }
    this._planDay(day);
  }

  _closeBlock(block, day) {
    if (block.mandatory) {
      for (const r of this.residents) if (!r.today[block.id]) this._recordAttendance(r, block, 'missed');
    }
    bus.emit(Events.BLOCK_END, { block, day, summary: { ...this.today } });
  }

  /** Decide whether an agent should set off for their current/next block. */
  _maybeDepart(a, now) {
    const current = blockAt(now);
    let target = null;

    if (current && a.blockId === current.id) {
      if (current.mandatory) return; // nobody leaves a mandatory block early
    }

    // Already heading to a block that starts soon?
    const assigned = a.blockId && TIMETABLE.find((b) => b.id === a.blockId);
    const movedOn = assigned && assigned.start > now && assigned.start - now < 120;

    if (current && a.blockId !== current.id) {
      if (!movedOn) target = current; // late for a block already in progress
    } else {
      const next = nextBlock(now);
      if (next.start <= now || next.id === a.blockId) return; // wrapped to tomorrow or already there
      const plan = a.plan[next.id];
      const from = this.nav.placementPosition(a.placement);
      const travel = NavGraph.pathLength(this._previewPath(a, plan.zone), from) / a.walkSpeed;
      if (now >= next.start - travel - plan.slack) target = next;
    }
    if (target) this._sendTo(a, target);
  }

  _previewPath(a, zone) {
    const z = ZONES[zone];
    return this.nav.buildPath(a.placement, { zone, slot: z.indoor ? null : { via: [], ...z.slots[0] } });
  }

  _sendTo(a, block) {
    const zone = a.plan[block.id].zone;
    a.blockId = block.id;

    if (zone === a.placement.zone && !a.path.length) {
      this._arrive(a, block); // already there
      return;
    }

    const to = { zone, slot: this._claim(a, zone) };
    if (a.anim === ANIM.HIDDEN) a.position.copy(this.nav.placementPosition(a.placement)); // step out the door
    // If redirected mid-walk, finish the current leg first so the route stays on the network.
    a.path = [...a.path, ...this.nav.buildPath(a.placement, to)];
    this.nav.releaseSlot(a.placement.zone, a.placement.slot);
    a.placement = to;
    a.sim.assignedSocket = to.slot?.id ?? null;
    a.anim = ANIM.WALK;
  }

  _arrive(a, block) {
    a.path = [];
    this._settle(a, block);
    if (!ScheduleSystem.isStaff(a) && block.mandatory && !a.today[block.id]) {
      const lateBy = Math.floor(this.clock.minuteOfDay) - block.start; // whole minutes
      const status = lateBy <= 0 ? 'onTime' : lateBy <= LATE_GRACE ? 'late' : 'missed';
      this._recordAttendance(a, block, status);
    }
  }

  /** Pose and facing once in place. */
  _settle(a, block) {
    const zone = ZONES[a.placement.zone];
    if (zone.indoor) {
      a.anim = ANIM.HIDDEN;
      return;
    }
    const staff = ScheduleSystem.isStaff(a);
    a.anim = staff ? ANIM.SUPERVISE : ARRIVE_ANIM[block?.kind] ?? ANIM.IDLE;
    const look = staff ? zone.crowd : zone.focus;
    if (look) {
      let h = Math.atan2(look.x - a.position.x, look.z - a.position.z);
      if (!staff && block?.kind === 'work') h += Math.PI / 2; // rake along the ring, not at the fountain
      a.heading = h;
    }
  }

  _recordAttendance(r, block, status) {
    r.today[block.id] = status;
    this.today[status]++;
    bus.emit(Events.ATTENDANCE, { resident: r, block, status });
  }

  _place(a, placement) {
    a.placement = placement;
    a.sim.assignedSocket = placement.slot?.id ?? null;
    a.position.copy(this.nav.placementPosition(placement));
    a.path = [];
    a.anim = ZONES[placement.zone].indoor ? ANIM.HIDDEN : ANIM.IDLE;
  }

  // -------------------------------------------------------------- per frame
  /** @param {number} dtGame game minutes elapsed this frame */
  update(dtGame) {
    const block = blockAt(this.clock.minuteOfDay);
    for (const a of this.agents) {
      if (dtGame > 0 && a.path.length) this._walk(a, dtGame);
      a.activity = this._activityOf(a, block);
    }
  }

  _activityOf(a, block) {
    if (a.path.length) return 'walking';
    if (block && a.blockId === block.id) return block.kind;
    return ZONES[a.placement.zone].indoor ? 'rest' : 'idle';
  }

  _walk(a, dtGame) {
    let budget = a.walkSpeed * dtGame;
    while (budget > 0 && a.path.length) {
      const target = a.path[0];
      const dx = target.x - a.position.x;
      const dz = target.z - a.position.z;
      const dist = Math.hypot(dx, dz, target.y - a.position.y);
      if (dist > 1e-3) a.heading = Math.atan2(dx, dz);
      if (dist <= budget) {
        a.position.copy(target);
        a.path.shift();
        budget -= dist;
      } else {
        a.position.lerp(target, budget / dist);
        budget = 0;
      }
    }
    if (!a.path.length) this._arrive(a, TIMETABLE.find((b) => b.id === a.blockId));
  }

  dispose() {
    this._off.forEach((off) => off());
  }
}
