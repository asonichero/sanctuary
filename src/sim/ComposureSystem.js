import { bus, Events } from '../core/EventBus.js';
import { ROLES } from '../content/roster.js';
import { BANDS } from '../content/composure.js';
import {
  applyDrift, applyAttendance, applyOvernight, bandWithHysteresis, nextState,
} from './composureRules.js';
import { blockedReason, cooldownLeft, stamp, applyStatAction } from './interactionRules.js';

/** Re-evaluate bands and states at most this often (game minutes) to keep frames cheap. */
const EVAL_STEP = 1;

/**
 * ComposureSystem — state and fatigue tracking.
 *
 * Every frame it drifts each agent's composure / fatigue / defiance by the
 * activity ScheduleSystem published (`agent.activity`), shaped by trait,
 * tier and current tiredness (see sim/composureRules.js and
 * content/composure.js). It then works out the aura band (Cool Blue ≥ 70,
 * Amber 30–69, Red < 30) and the agent state, emitting AURA_CHANGED and
 * STATE_CHANGED on transitions. A resident who reaches Red is flagged
 * QUEUED_RESET until they recover to 40.
 *
 * Attendance outcomes, overnight recovery and the player's stat actions
 * (patrol check, encourage) are applied here as well, so this is the only
 * system that writes `sim.stats`.
 */
export class ComposureSystem {
  constructor({ agents, clock }) {
    this.agents = agents;
    this.clock = clock;
    this.patrolChecks = 0; // today
    this.residents = agents.filter((a) => a.sim.role === ROLES.RESIDENT);
    this.staff = agents.filter((a) => a.sim.role === ROLES.STAFF);
    this._acc = 0;

    this._off = [
      bus.on(Events.ATTENDANCE, ({ resident, status }) => {
        applyAttendance(resident.sim, status);
        this._evaluate(resident);
      }),
      bus.on(Events.INTERACT, ({ action, agent }) => this._onInteract(action, agent)),
      bus.on(Events.CLOCK_DAY, () => {
        this.patrolChecks = 0;
        for (const a of this.agents) applyOvernight(a.sim);
        this.agents.forEach((a) => this._evaluate(a));
        this._emitStats();
      }),
      bus.on(Events.CLOCK_MINUTE, ({ minuteOfDay }) => {
        if (minuteOfDay % 5 === 0) this._emitStats();
      }),
    ];
  }

  /** @param {number} dtGame game minutes elapsed this frame */
  update(dtGame) {
    if (dtGame <= 0) return;
    for (const a of this.agents) applyDrift(a.sim, a.activity, dtGame, a.steadiness);
    this._acc += dtGame;
    if (this._acc >= EVAL_STEP) {
      this._acc = 0;
      for (const a of this.agents) this._evaluate(a);
    }
  }

  _onInteract(action, a) {
    if (action !== 'check' && action !== 'encourage') return;
    const now = this.clock.total;
    const result = (ok, message) => bus.emit(Events.INTERACT_RESULT, { action, agent: a, ok, message });

    if (action === 'check') {
      this.patrolChecks++;
      if (a.sim.role !== ROLES.RESIDENT) return result(true, `${a.name} — on post, all in order`);
      if (cooldownLeft(a, 'check', now) > 0) return result(true, `${a.name} — checked recently`);
      stamp(a, 'check', now);
      applyStatAction(a.sim, 'check');
      this._evaluate(a);
      return result(true, `Checked on ${a.name}`);
    }

    const reason = blockedReason(a, action, { now, walking: a.path.length > 0, indoor: false, stretching: false });
    if (reason) return result(false, reason);
    stamp(a, action, now);
    applyStatAction(a.sim, action);
    this._evaluate(a);
    return result(true, `${a.name} steadies (composure ${Math.round(a.sim.stats.composure)})`);
  }

  _evaluate(a) {
    if (a.sim.role !== ROLES.RESIDENT) return;
    const band = bandWithHysteresis(a.sim.stats.composure, a.band);
    if (band !== a.band) {
      const from = a.band;
      a.band = band;
      bus.emit(Events.AURA_CHANGED, { agent: a, from, to: band });
    }
    const state = nextState(a.sim, band);
    if (state !== a.sim.state) {
      const from = a.sim.state;
      a.sim.state = state;
      bus.emit(Events.STATE_CHANGED, { agent: a, from, to: state });
    }
  }

  stats() {
    const rs = this.residents;
    const n = Math.max(1, rs.length);
    const avg = (k) => rs.reduce((s, r) => s + r.sim.stats[k], 0) / n;
    const bands = { BLUE: 0, AMBER: 0, RED: 0 };
    for (const r of rs) bands[r.band]++;
    return {
      population: rs.length,
      staff: this.staff.length,
      avg: { composure: avg('composure'), fatigue: avg('fatigue'), defiance: avg('defiance') },
      bands,
      queued: rs.filter((r) => r.sim.state === 'QUEUED_RESET').length,
      patrolChecks: this.patrolChecks,
    };
  }

  _emitStats() {
    bus.emit(Events.FACILITY_STATS, this.stats());
  }

  static bandColor(band) {
    return BANDS[band].color;
  }

  dispose() {
    this._off.forEach((off) => off());
  }
}
