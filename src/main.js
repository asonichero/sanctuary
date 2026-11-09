import { bus, Events } from './core/EventBus.js';
import { EstateBuilder } from './world/EstateBuilder.js';
import { TimeManager } from './sim/TimeManager.js';
import { SubjectFactory } from './sim/SubjectFactory.js';
import { ScheduleSystem } from './sim/ScheduleSystem.js';
import { ComposureSystem } from './sim/ComposureSystem.js';
import { Hud } from './ui/Hud.js';

const params = new URLSearchParams(location.search);
const SEED = params.get('seed') ?? 'sanctuary-alpha';
const RESIDENT_COUNT = 24;
const STAFF_COUNT = 3;

const viewport = document.getElementById('viewport');
const fpsEl = document.getElementById('hud-fps');

bus.emit(Events.BOOT);

const estate = new EstateBuilder(viewport).build();
const clock = new TimeManager({ day: 1 });
const factory = new SubjectFactory({ seed: SEED });
const agents = [...factory.createResidents(RESIDENT_COUNT), ...factory.createStaff(STAFF_COUNT)];
const schedule = new ScheduleSystem({ agents, scene: estate.scene, clock, seed: SEED });
const composure = new ComposureSystem({ agents });
const hud = new Hud({ clock, schedule, composure });

estate.setTimeOfDay(clock.hours);

let last = performance.now();
let elapsed = 0;
let tabHidden = false;
let fpsFrames = 0;
let fpsTime = 0;

bus.on(Events.PAUSE, () => (tabHidden = true));
bus.on(Events.RESUME, () => {
  tabHidden = false;
  last = performance.now();
});
document.addEventListener('visibilitychange', () =>
  bus.emit(document.hidden ? Events.PAUSE : Events.RESUME),
);

function frame(now) {
  requestAnimationFrame(frame);
  if (tabHidden) return;

  // Clamp dt so a stalled tab doesn't fling the simulation forward.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  const dtGame = clock.update(dt);
  schedule.update(dtGame); // movement, attendance, publishes agent.activity
  composure.update(dtGame); // stats, aura bands, states
  for (const a of agents) SubjectFactory.syncMesh(a, { dtGame, dtReal: dt, time: elapsed });
  estate.setTimeOfDay(clock.hours);
  estate.update(dt);
  hud.update(dt);
  bus.emit(Events.TICK, { dt, dtGame, elapsed });
  estate.render();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
}

requestAnimationFrame(frame);
bus.emit(Events.READY, { zones: [...estate.zones.keys()] });

// Handy for poking at the scene from devtools (and the smoke test).
if (import.meta.env.DEV) window.__sanctuary = { bus, estate, clock, schedule, composure, agents };
