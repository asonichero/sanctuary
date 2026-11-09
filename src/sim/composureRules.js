/**
 * Composure rules — pure functions over the plain `sim` record
 * ({ role, tier, trait, stats, state }). No three.js, no bus: runs in Node.
 */
import {
  BANDS, BAND_HYSTERESIS, RESET_RECOVERY, ACTIVITY, TRAIT_DRIFT, TIER_LOSS,
  FATIGUE_LOSS_GAIN, DEFIANCE_LOSS_DIV, DEFIANCE_IN_RED, DEFIANCE_REST_DECAY,
  ATTENDANCE, OVERNIGHT,
} from '../content/composure.js';
import { ROLES, STATES } from '../content/roster.js';

export const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** Band for a composure value, ignoring history. */
export function bandOf(composure) {
  if (composure >= BANDS.BLUE.min) return BANDS.BLUE.id;
  if (composure >= BANDS.AMBER.min) return BANDS.AMBER.id;
  return BANDS.RED.id;
}

/**
 * Band with hysteresis: stays in `prev` until composure is BAND_HYSTERESIS
 * past the threshold, so a value hovering on a line doesn't flicker.
 */
export function bandWithHysteresis(composure, prev) {
  const raw = bandOf(composure);
  if (!prev || raw === prev) return raw;
  const order = [BANDS.RED.id, BANDS.AMBER.id, BANDS.BLUE.id];
  const up = order.indexOf(raw) > order.indexOf(prev);
  // Threshold between prev and its neighbour in the direction of travel.
  const line = up ? BANDS[order[order.indexOf(prev) + 1]].min : BANDS[prev].min;
  return up ? (composure >= line + BAND_HYSTERESIS ? raw : prev) : composure < line - BAND_HYSTERESIS ? raw : prev;
}

/** Multiplier on composure loss from tiredness, defiance, trait and tier. */
export function lossMultiplier(sim, activity, steadiness = 1) {
  const t = TRAIT_DRIFT[sim.trait];
  const traitMul = t.loss[activity] ?? 1;
  const knee = t.fatigueKnee;
  const fatigueMul = 1 + (Math.max(0, sim.stats.fatigue - knee) / (100 - knee)) * (t.fatigueGain ?? FATIGUE_LOSS_GAIN);
  const defianceMul = 1 + sim.stats.defiance / DEFIANCE_LOSS_DIV;
  return traitMul * (TIER_LOSS[sim.tier] ?? 1) * fatigueMul * defianceMul * steadiness;
}

/**
 * Per-minute stat deltas for one agent doing `activity`.
 * @returns {{ composure:number, fatigue:number, defiance:number }}
 */
export function driftRates(sim, activity, steadiness = 1) {
  const a = ACTIVITY[activity] ?? ACTIVITY.idle;
  const t = TRAIT_DRIFT[sim.trait];
  if (sim.role === ROLES.STAFF) return { composure: 0, fatigue: Math.max(0, a.fatigue) * 0.3 + Math.min(0, a.fatigue), defiance: 0 };

  const composure = a.composure < 0 ? a.composure * lossMultiplier(sim, activity, steadiness) : a.composure;
  const fatigue = a.fatigue > 0 ? a.fatigue * (t.fatigue[activity] ?? 1) : a.fatigue;

  let defiance = 0;
  if (a.static) defiance += t.staticDefiance;
  if (bandOf(sim.stats.composure) === BANDS.RED.id) defiance += DEFIANCE_IN_RED;
  if (activity === 'rest') defiance -= DEFIANCE_REST_DECAY;
  return { composure, fatigue, defiance };
}

/** Advance stats by `minutes` of `activity`. Mutates and returns `sim.stats`. */
export function applyDrift(sim, activity, minutes, steadiness = 1) {
  if (minutes <= 0 || sim.state === STATES.IN_SITU_CORRECTION) return sim.stats;
  const d = driftRates(sim, activity, steadiness);
  const s = sim.stats;
  s.composure = clamp(s.composure + d.composure * minutes);
  s.fatigue = clamp(s.fatigue + d.fatigue * minutes);
  s.defiance = clamp(s.defiance + d.defiance * minutes);
  return s;
}

/** Apply an attendance outcome ('onTime' | 'late' | 'missed'). */
export function applyAttendance(sim, status) {
  const fx = ATTENDANCE[status];
  sim.stats.composure = clamp(sim.stats.composure + fx.composure);
  sim.stats.defiance = clamp(sim.stats.defiance + fx.defiance);
  return sim.stats;
}

/** Overnight recovery between days. */
export function applyOvernight(sim) {
  const s = sim.stats;
  const base = OVERNIGHT.baseline[sim.tier] ?? 80;
  s.fatigue = clamp(s.fatigue * OVERNIGHT.fatigueKeep);
  s.composure = clamp(s.composure + (base - s.composure) * OVERNIGHT.composurePull);
  s.defiance = clamp(s.defiance * OVERNIGHT.defianceKeep);
  return s;
}

/**
 * State machine driven by composure. Residents in the red are queued for a
 * reset; a queued resident who recovers on their own goes back to the
 * schedule. IN_SITU_CORRECTION is left alone (owned by a later system).
 */
export function nextState(sim, band) {
  if (sim.role !== ROLES.RESIDENT) return sim.state;
  if (sim.state === STATES.SCHEDULED_TASK && band === BANDS.RED.id) return STATES.QUEUED_RESET;
  if (sim.state === STATES.QUEUED_RESET && sim.stats.composure >= RESET_RECOVERY) return STATES.SCHEDULED_TASK;
  return sim.state;
}
