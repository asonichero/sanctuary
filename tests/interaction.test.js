import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bus, Events } from '../src/core/EventBus.js';
import { TimeManager } from '../src/sim/TimeManager.js';
import { SubjectFactory } from '../src/sim/SubjectFactory.js';
import { ScheduleSystem } from '../src/sim/ScheduleSystem.js';
import { ComposureSystem } from '../src/sim/ComposureSystem.js';
import { blockedReason, cooldownLeft } from '../src/sim/interactionRules.js';
import { ZONES } from '../src/world/NavGraph.js';
import { hm } from '../src/content/timetable.js';

function world(seed = 'ix') {
  bus.clear();
  const clock = new TimeManager();
  const f = new SubjectFactory({ seed });
  const agents = [...f.createResidents(24), ...f.createStaff(3)];
  const schedule = new ScheduleSystem({ agents, scene: new THREE.Scene(), clock, seed });
  const composure = new ComposureSystem({ agents, clock });
  const results = [];
  bus.on(Events.INTERACT_RESULT, (r) => results.push(r));
  const until = (min) => {
    while (clock.minuteOfDay < min) {
      const dt = clock.advance(0.25);
      schedule.update(dt);
      composure.update(dt);
    }
  };
  const act = (action, agent) => bus.emit(Events.INTERACT, { action, agent });
  return { clock, agents, schedule, composure, results, until, act };
}

test('everyone starts the day indoors, visible on a bed or behind the desk', () => {
  const { agents } = world();
  for (const a of agents) {
    assert.ok(ZONES[a.placement.zone].indoor);
    assert.ok(a.placement.slot, `${a.id} has a socket`);
    assert.notEqual(a.anim, 'hidden');
  }
  const beds = new Set(agents.filter((a) => a.sim.role === 'RESIDENT').map((a) => a.sim.assignedSocket));
  assert.equal(beds.size, 24); // one bed each
});

test('patrol check: +2 composure, then no effect for 30 minutes; staff are just checked in', () => {
  const { agents, results, until, act, composure } = world();
  until(hm(10));
  const r = agents.find((a) => a.sim.role === 'RESIDENT');
  const before = r.sim.stats.composure;
  act('check', r);
  assert.ok(Math.abs(r.sim.stats.composure - Math.min(100, before + 2)) < 1e-9);
  act('check', r);
  assert.match(results.at(-1).message, /checked recently/);
  act('check', agents.find((a) => a.sim.role === 'STAFF'));
  assert.match(results.at(-1).message, /on post/);
  assert.equal(composure.patrolChecks, 3);
});

test('encourage has a cooldown and staff refuse resident-only actions', () => {
  const { agents, results, until, act, clock } = world();
  until(hm(10));
  const r = agents.find((a) => a.sim.role === 'RESIDENT');
  act('encourage', r);
  assert.equal(results.at(-1).ok, true);
  act('encourage', r);
  assert.equal(results.at(-1).ok, false);
  assert.ok(cooldownLeft(r, 'encourage', clock.total) > 59);
  const staff = agents.find((a) => a.sim.role === 'STAFF');
  assert.equal(blockedReason(staff, 'encourage', { now: clock.total }), 'Residents only');
});

test('stretch break overrides the activity in place for 10 minutes', () => {
  const { agents, until, act, schedule } = world();
  until(hm(10));
  const r = agents.find((a) => a.sim.role === 'RESIDENT' && a.placement.zone === 'Somatic Studio');
  const fatigue = r.sim.stats.fatigue;
  act('stretch', r);
  until(hm(10, 5));
  assert.equal(r.activity, 'stretch');
  assert.equal(r.anim, 'stretch');
  assert.ok(r.sim.stats.fatigue < fatigue);
  until(hm(10, 12));
  assert.equal(r.activity, 'hold');
  assert.equal(r.anim, 'hold');
  assert.equal(schedule.interactionContext(r).stretching, false);
});

test('send to rest: walks home, is excused, and rejoins the next block', () => {
  const { agents, until, act, schedule } = world();
  until(hm(10));
  const r = agents.find((a) => a.sim.role === 'RESIDENT' && a.placement.zone === 'Somatic Studio');
  act('rest', r);
  assert.equal(r.placement.zone, 'Residence Wing');
  until(hm(11));
  assert.equal(r.path.length, 0);
  assert.equal(r.activity, 'rest');
  until(hm(13, 30));
  assert.equal(r.placement.zone, 'Sunken Courtyard');
  assert.ok(['onTime', 'late'].includes(r.today.grounds));
  assert.equal(schedule.today.missed, 0);
});

test('send to rest during a transition excuses the next block instead', () => {
  const { agents, until, act } = world();
  until(hm(9, 5)); // between alignment and somatic
  const r = agents.find((a) => a.sim.role === 'RESIDENT' && !a.path.length && a.placement.zone === 'Alignment Hall');
  act('rest', r);
  until(hm(12, 5));
  assert.equal(r.today.somatic, 'excused');
  assert.equal(r.placement.zone, 'Residence Wing');
});
