import { bus, Events } from '../core/EventBus.js';
import { Random } from '../core/Random.js';
import { NavGraph, ZONES } from '../world/NavGraph.js';
import { ANIM } from './SubjectFactory.js';
import { TIMETABLE, LATE_GRACE, blockAt, nextBlock } from '../content/timetable.js';
import { ROLES } from '../content/roster.js';
import { ACTIONS } from '../content/interactions.js';
import { blockedReason, stamp } from './interactionRules.js';

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
 * It also carries out the player's movement-type interactions: a stretch
 * break (activity override in place) and send-to-rest (excused to their bed
 * until the block ends). Stats are not touched here; ComposureSystem owns them.
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

    for (const a of agents) scene.add(a.mesh);
    this._homeAll();
    this._planDay(clock.day);
    this._syncInitialBlock();

    this._off = [
      bus.on(Events.CLOCK_MINUTE, (e) => this._onMinute(e)),
      bus.on(Events.CLOCK_DAY, ({ day }) => this._onNewDay(day)),
      bus.on(Events.INTERACT, ({ action, agent }) => this._onInteract(action, agent)),
    ];
    bus.emit(Events.AGENTS_SPAWNED, { agents, residents: this.residents, staff: this.staff });
  }

  static isStaff(a) {
    return a.sim.role === ROLES.STAFF;
  }

  static homeZone(a) {
    return ScheduleSystem.isStaff(a) ? 'Main House' : 'Residence Wing';
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
    this._homeAll();
    this._planDay(day);
  }

  /** Put every agent on a bed / post in their home building. */
  _homeAll() {
    for (const a of this.agents) {
      this.nav.releaseSlot(a.placement.zone, a.placement.slot);
      const zone = ScheduleSystem.homeZone(a);
      this._place(a, { zone, slot: this._claim(a, zone) });
      a.blockId = null;
      a.override = null;
      a.excusedUntil = null;
      this._settle(a, null);
    }
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

    if (a.excusedUntil != null) {
      if (now < a.excusedUntil) return; // sent to rest by the player
      a.excusedUntil = null;
    }
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
    const sock = (ScheduleSystem.isStaff(a) && z.posts?.[0]) || z.slots?.[0] || z.posts?.[0];
    return this.nav.buildPath(a.placement, { zone, slot: sock ? { via: [], ...sock } : null });
  }

  _sendTo(a, block) {
    this._dispatch(a, a.plan[block.id].zone, block);
  }

  /** Walk `a` to `zone` for `block` (block may be null). */
  _dispatch(a, zone, block) {
    a.blockId = block?.id ?? null;
    a.override = null;

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
    if (!ScheduleSystem.isStaff(a) && block?.mandatory && !a.today[block.id]) {
      const lateBy = Math.floor(this.clock.minuteOfDay) - block.start; // whole minutes
      const status = lateBy <= 0 ? 'onTime' : lateBy <= LATE_GRACE ? 'late' : 'missed';
      this._recordAttendance(a, block, status);
    }
  }

  /** Pose and facing once in place. */
  _settle(a, block) {
    const zone = ZONES[a.placement.zone];
    const slot = a.placement.slot;
    if (!slot) {
      a.anim = ANIM.HIDDEN; // no socket to stand at (shouldn't happen with the current zones)
      return;
    }
    const staff = ScheduleSystem.isStaff(a);
    if (staff) a.anim = ANIM.SUPERVISE;
    else if (zone.indoor) a.anim = ANIM.SEATED; // on the edge of their bed
    else a.anim = ARRIVE_ANIM[block?.kind] ?? ANIM.IDLE;

    if (slot.face != null) {
      a.heading = slot.face;
      return;
    }
    const look = staff ? zone.crowd : zone.focus;
    if (look) {
      let h = Math.atan2(look.x - a.position.x, look.z - a.position.z);
      if (!staff && block?.kind === 'work') h += Math.PI / 2; // rake along the ring, not at the fountain
      a.heading = h;
    }
  }

  // ------------------------------------------------------- player actions
  /** Context the interaction rules need about an agent right now. */
  interactionContext(a) {
    return {
      now: this.clock.total,
      walking: a.path.length > 0,
      indoor: !!ZONES[a.placement.zone].indoor,
      stretching: a.override?.kind === 'stretch' && this.clock.total < a.override.until,
    };
  }

  _onInteract(action, a) {
    if (action !== 'stretch' && action !== 'rest') return;
    const ctx = this.interactionContext(a);
    const reason = blockedReason(a, action, ctx);
    if (reason) {
      bus.emit(Events.INTERACT_RESULT, { action, agent: a, ok: false, message: reason });
      return;
    }
    stamp(a, action, ctx.now);
    if (action === 'stretch') {
      a.override = { kind: 'stretch', until: ctx.now + ACTIONS.stretch.duration };
      a.anim = ANIM.STRETCH;
      bus.emit(Events.INTERACT_RESULT, { action, agent: a, ok: true, message: `${a.name} takes a ${ACTIONS.stretch.duration}-minute stretch` });
      return;
    }
    // Send to rest: excused until the current block (or the next one, in a transition) ends.
    const now = this.clock.minuteOfDay;
    const block = blockAt(now) ?? nextBlock(now);
    a.today[block.id] ??= 'excused';
    a.excusedUntil = block.end;
    this._dispatch(a, ScheduleSystem.homeZone(a), block);
    bus.emit(Events.INTERACT_RESULT, { action, agent: a, ok: true, message: `${a.name} heads back to rest until ${block.label} ends` });
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
    a.anim = placement.slot ? ANIM.IDLE : ANIM.HIDDEN;
  }

  // -------------------------------------------------------------- per frame
  /** @param {number} dtGame game minutes elapsed this frame */
  update(dtGame) {
    const block = blockAt(this.clock.minuteOfDay);
    for (const a of this.agents) {
      if (dtGame > 0 && a.path.length) this._walk(a, dtGame);
      if (a.override && this.clock.total >= a.override.until) {
        a.override = null; // stretch over: back to the block's pose
        this._settle(a, TIMETABLE.find((b) => b.id === a.blockId));
      }
      a.activity = this._activityOf(a, block);
    }
  }

  _activityOf(a, block) {
    if (a.path.length) return 'walking';
    if (a.override) return a.override.kind;
    if (ZONES[a.placement.zone].indoor) return 'rest';
    if (block && a.blockId === block.id) return block.kind;
    return 'idle';
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
