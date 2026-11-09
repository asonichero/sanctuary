import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bus, Events } from '../src/core/EventBus.js';
import { TimeManager } from '../src/sim/TimeManager.js';
import { SubjectFactory } from '../src/sim/SubjectFactory.js';
import { ScheduleSystem } from '../src/sim/ScheduleSystem.js';
import { ComposureSystem } from '../src/sim/ComposureSystem.js';
import { ZONES } from '../src/world/NavGraph.js';
import { DAY, hm } from '../src/content/timetable.js';

/** Headless run: same wiring as main.js, stepped in fixed game-minute increments. */
function run({ seed = 'test', days = 1, residents = 24, staff = 3, step = 0.25, probe } = {}) {
  bus.clear();
  const clock = new TimeManager({ day: 1 });
  const factory = new SubjectFactory({ seed });
  const agents = [...factory.createResidents(residents), ...factory.createStaff(staff)];
  const schedule = new ScheduleSystem({ agents, scene: new THREE.Scene(), clock, seed });
  const composure = new ComposureSystem({ agents, clock });
  const log = { attendance: [], auras: [], states: [], days: [] };
  bus.on(Events.ATTENDANCE, ({ resident, block, status }) => log.attendance.push({ day: clock.day, id: resident.id, block: block.id, status }));
  bus.on(Events.AURA_CHANGED, ({ agent, to }) => log.auras.push({ id: agent.id, to }));
  bus.on(Events.STATE_CHANGED, ({ agent, to }) => log.states.push({ id: agent.id, to }));
  bus.on(Events.CLOCK_DAY, ({ day }) => log.days.push(day));
  while (clock.day <= days) {
    const dt = clock.advance(step);
    schedule.update(dt);
    composure.update(dt);
    probe?.(clock, agents, schedule);
  }
  schedule.dispose();
  composure.dispose();
  return { agents, log, schedule, composure, clock };
}

test('time manager: the day opens at 06:40 and jumps from 18:30 to the next morning', () => {
  bus.clear();
  const days = [];
  bus.on(Events.CLOCK_DAY, ({ day }) => days.push(day));
  const c = new TimeManager();
  assert.equal(c.minuteOfDay, DAY.open);
  assert.equal(c.phase, 'muster');
  c.advance(hm(12) - DAY.open);
  assert.equal(c.phase, 'day');
  assert.equal(c.block, null); // 12:00–12:10 is a transition
  c.advance(DAY.close - hm(12) - 0.5);
  assert.equal(c.day, 1);
  c.advance(1);
  assert.equal(c.day, 2);
  assert.equal(c.minuteOfDay, DAY.open);
  assert.deepEqual(days, [2]);
});

test('userData carries exactly the spec state, as plain JSON', () => {
  bus.clear();
  const f = new SubjectFactory({ seed: 'ud' });
  const [r] = f.createResidents(1);
  const [s] = f.createStaff(1);
  assert.equal(r.mesh.userData, r.sim);
  assert.deepEqual(Object.keys(r.mesh.userData), ['id', 'role', 'tier', 'trait', 'stats', 'state', 'assignedSocket']);
  assert.match(r.sim.id, /^res_\d{3}$/);
  assert.match(s.sim.id, /^stf_\d{3}$/);
  assert.equal(s.sim.role, 'STAFF');
  assert.equal(s.sim.tier, 'CHARCOAL');
  assert.doesNotThrow(() => JSON.stringify(r.mesh.userData));
  assert.doesNotThrow(() => r.mesh.clone()); // Object3D.clone deep-copies userData via JSON
});

test('roster: even trait spread, mostly newcomers, no staff tier among residents', () => {
  bus.clear();
  const rs = new SubjectFactory({ seed: 'mix' }).createResidents(24);
  const count = (k, v) => rs.filter((r) => r.sim[k] === v).length;
  for (const t of ['SLOUCHER', 'RESTLESS', 'OVERACHIEVER']) assert.equal(count('trait', t), 8);
  assert.equal(count('tier', 'SLATE'), 14);
  assert.equal(count('tier', 'OCHRE'), 10);
});

test('a full day: everyone reaches each block, mostly on time, and is home after dismissal', () => {
  const seen = {};
  const { agents, log } = run({
    days: 1,
    probe: (clock, agents) => {
      const m = Math.floor(clock.minuteOfDay);
      if (m === hm(18, 29) && !seen.home) seen.home = agents.map((a) => ZONES[a.placement.zone].indoor && !a.path.length);
      for (const [label, at, zone] of [['alignment', hm(8), 'Alignment Hall'], ['somatic', hm(11), 'Somatic Studio'],
        ['grounds', hm(15), 'Sunken Courtyard'], ['assembly', hm(17), 'Assembly Lawn']]) {
        if (m === at && !seen[label]) {
          seen[label] = agents.map((a) => ({ role: a.sim.role, zone: a.placement.zone, socket: a.sim.assignedSocket, walking: a.path.length > 0 }));
          for (const a of seen[label]) assert.equal(a.zone, zone, `${label}: ${a.role} in ${a.zone}`);
        }
      }
    },
  });
  assert.equal(Object.keys(seen).length, 5);
  // Residents on resident sockets, staff on posts.
  for (const a of seen.somatic) assert.match(a.socket, a.role === 'STAFF' ? /\/posts#/ : /\/slots#/);

  const day1 = log.attendance.filter((e) => e.day === 1);
  assert.equal(day1.length, 24 * 4); // one record per resident per mandatory block
  const onTime = day1.filter((e) => e.status === 'onTime').length;
  assert.ok(onTime / day1.length > 0.75, `on time ${onTime}/${day1.length}`);

  // Everyone walked home during dismissal, and day 2 opened.
  assert.ok(seen.home.every(Boolean), 'everyone home by 18:29');
  assert.deepEqual(log.days, [2]);
  assert.equal(agents.length, 27);
});

test('composure drifts by trait: some residents go red and are queued, staff never are', () => {
  const { agents, log } = run({ days: 2 });
  const red = new Set(log.auras.filter((e) => e.to === 'RED').map((e) => e.id));
  const queued = new Set(log.states.filter((e) => e.to === 'QUEUED_RESET').map((e) => e.id));
  assert.ok(red.size > 0, 'someone should hit red over two days');
  assert.ok(red.size < 24, 'not everyone should hit red');
  assert.deepEqual([...queued].sort(), [...red].sort());
  for (const id of red) assert.ok(id.startsWith('res_'));
  const byTrait = (t) => agents.filter((a) => a.sim.trait === t && red.has(a.id)).length;
  assert.ok(byTrait('SLOUCHER') >= byTrait('OVERACHIEVER'), 'slouchers should crack at least as often');
});

test('same seed ⇒ same day', () => {
  const a = run({ seed: 'det', days: 1 });
  const b = run({ seed: 'det', days: 1 });
  assert.deepEqual(a.agents.map((x) => x.sim), b.agents.map((x) => x.sim));
  assert.deepEqual(a.log, b.log);
});
