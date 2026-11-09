import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandOf, bandWithHysteresis, driftRates, applyDrift, applyOvernight, nextState,
} from '../src/sim/composureRules.js';

const sim = (over = {}) => ({
  id: 'res_x', role: 'RESIDENT', tier: 'OCHRE', trait: 'SLOUCHER',
  stats: { composure: 80, fatigue: 10, defiance: 0 }, state: 'SCHEDULED_TASK', assignedSocket: null,
  ...over, stats: { composure: 80, fatigue: 10, defiance: 0, ...over.stats },
});

test('aura bands: Cool Blue ≥ 70, Amber 30–69, Red < 30', () => {
  assert.equal(bandOf(100), 'BLUE');
  assert.equal(bandOf(70), 'BLUE');
  assert.equal(bandOf(69.9), 'AMBER');
  assert.equal(bandOf(30), 'AMBER');
  assert.equal(bandOf(29.9), 'RED');
  assert.equal(bandOf(0), 'RED');
});

test('hysteresis holds a band until composure is clearly past the line', () => {
  assert.equal(bandWithHysteresis(69, 'BLUE'), 'BLUE');
  assert.equal(bandWithHysteresis(68, 'BLUE'), 'AMBER');
  assert.equal(bandWithHysteresis(70.5, 'AMBER'), 'AMBER');
  assert.equal(bandWithHysteresis(72, 'AMBER'), 'BLUE');
  assert.equal(bandWithHysteresis(29, 'AMBER'), 'AMBER');
  assert.equal(bandWithHysteresis(28, 'AMBER'), 'RED');
  assert.equal(bandWithHysteresis(31, 'RED'), 'RED');
  assert.equal(bandWithHysteresis(32, 'RED'), 'AMBER');
  assert.equal(bandWithHysteresis(90, 'RED'), 'BLUE'); // a big jump crosses both lines
});

test('slouchers lose alignment faster than anyone in static holds', () => {
  const loss = (trait) => -driftRates(sim({ trait }), 'hold').composure;
  assert.ok(loss('SLOUCHER') > loss('RESTLESS'));
  assert.ok(loss('RESTLESS') > loss('OVERACHIEVER'));
});

test('restless residents are fine on the move but build defiance when held still', () => {
  const r = sim({ trait: 'RESTLESS' });
  assert.ok(-driftRates(r, 'work').composure < -driftRates(sim({ trait: 'SLOUCHER' }), 'work').composure);
  assert.ok(driftRates(r, 'hold').defiance > 0);
  assert.equal(driftRates(r, 'work').defiance, 0);
});

test('overachievers tire fastest, and fatigue past their knee accelerates the drop', () => {
  assert.ok(driftRates(sim({ trait: 'OVERACHIEVER' }), 'work').fatigue > driftRates(sim(), 'work').fatigue);
  const fresh = -driftRates(sim({ trait: 'OVERACHIEVER', stats: { fatigue: 20 } }), 'hold').composure;
  const spent = -driftRates(sim({ trait: 'OVERACHIEVER', stats: { fatigue: 95 } }), 'hold').composure;
  assert.ok(spent > fresh * 1.5, `${spent} vs ${fresh}`);
});

test('newcomers (SLATE) wobble more than intermediates (OCHRE)', () => {
  assert.ok(-driftRates(sim({ tier: 'SLATE' }), 'alignment').composure > -driftRates(sim({ tier: 'OCHRE' }), 'alignment').composure);
});

test('rest restores composure and fatigue; stats stay within 0–100', () => {
  const s = sim({ stats: { composure: 40, fatigue: 60 } });
  applyDrift(s, 'rest', 30);
  assert.ok(s.stats.composure > 40 && s.stats.fatigue < 60);
  applyDrift(s, 'rest', 10_000);
  assert.equal(s.stats.composure, 100);
  assert.equal(s.stats.fatigue, 0);
  applyDrift(s, 'hold', 10_000);
  assert.equal(s.stats.composure, 0);
  assert.equal(s.stats.fatigue, 100);
});

test('staff composure does not drift', () => {
  const st = sim({ role: 'STAFF', tier: 'CHARCOAL', trait: 'OVERACHIEVER' });
  applyDrift(st, 'hold', 300);
  assert.equal(st.stats.composure, 80);
});

test('drift is frozen during an in-situ correction', () => {
  const s = sim({ state: 'IN_SITU_CORRECTION' });
  applyDrift(s, 'hold', 100);
  assert.deepEqual(s.stats, { composure: 80, fatigue: 10, defiance: 0 });
});

test('red queues a reset; recovering to 40 returns to the schedule', () => {
  const s = sim({ stats: { composure: 20 } });
  assert.equal(nextState(s, 'RED'), 'QUEUED_RESET');
  s.state = 'QUEUED_RESET';
  s.stats.composure = 35;
  assert.equal(nextState(s, 'AMBER'), 'QUEUED_RESET');
  s.stats.composure = 40;
  assert.equal(nextState(s, 'AMBER'), 'SCHEDULED_TASK');
  assert.equal(nextState(sim({ role: 'STAFF' }), 'RED'), 'SCHEDULED_TASK');
});

test('overnight clears most fatigue and pulls composure toward the tier baseline', () => {
  const s = sim({ tier: 'SLATE', stats: { composure: 20, fatigue: 80, defiance: 40 } });
  applyOvernight(s);
  assert.equal(s.stats.fatigue, 20);
  assert.ok(s.stats.composure > 55 && s.stats.composure < 75);
  assert.ok(s.stats.defiance < 40);
});
