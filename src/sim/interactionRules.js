/**
 * Interaction rules — pure functions over the agent record (no three.js, no
 * bus). `now` is game minutes since day 1 00:00 (TimeManager.total).
 */
import { ACTIONS } from '../content/interactions.js';
import { ROLES, STATES } from '../content/roster.js';
import { clamp } from './composureRules.js';

/** Game minutes until `actionId` can be used on `agent` again (0 = ready). */
export function cooldownLeft(agent, actionId, now) {
  const def = ACTIONS[actionId];
  const last = agent.cooldowns?.[actionId];
  if (!def?.cooldown || last == null) return 0;
  return Math.max(0, last + def.cooldown - now);
}

export function stamp(agent, actionId, now) {
  (agent.cooldowns ??= {})[actionId] = now;
}

/**
 * Why `actionId` can't be used right now, or null if it can.
 * @param {{ now:number, walking:boolean, indoor:boolean, stretching:boolean }} ctx
 */
export function blockedReason(agent, actionId, ctx) {
  const staff = agent.sim.role === ROLES.STAFF;
  if (staff && actionId !== 'check' && actionId !== 'inspect') return 'Residents only';
  if (agent.sim.state === STATES.IN_SITU_CORRECTION) return 'Busy';
  if (actionId === 'inspect' || actionId === 'check') return null; // a check on cooldown still happens, just without effect
  const wait = cooldownLeft(agent, actionId, ctx.now);
  if (wait > 0) return `Again in ${Math.ceil(wait)} min`;
  if ((actionId === 'stretch' || actionId === 'rest') && ctx.walking) return 'On the move';
  if (actionId === 'stretch' && ctx.stretching) return 'Already stretching';
  if (actionId === 'stretch' && ctx.indoor) return 'Already resting';
  if (actionId === 'rest' && ctx.indoor) return 'Already in residence';
  return null;
}

/** One-off stat change for a stat action ('check' | 'encourage'). Mutates sim.stats. */
export function applyStatAction(sim, actionId) {
  const def = ACTIONS[actionId];
  sim.stats.composure = clamp(sim.stats.composure + (def.composure ?? 0));
  sim.stats.defiance = clamp(sim.stats.defiance + (def.defiance ?? 0));
  return sim.stats;
}
