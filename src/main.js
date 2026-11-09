import { bus, Events } from './core/EventBus.js';
import { EstateBuilder } from './world/EstateBuilder.js';

const viewport = document.getElementById('viewport');
const fpsEl = document.getElementById('hud-fps');

bus.emit(Events.BOOT);

const estate = new EstateBuilder(viewport).build();

let last = performance.now();
let elapsed = 0;
let paused = false;
let fpsFrames = 0;
let fpsTime = 0;

bus.on(Events.PAUSE, () => (paused = true));
bus.on(Events.RESUME, () => {
  paused = false;
  last = performance.now();
});
document.addEventListener('visibilitychange', () =>
  bus.emit(document.hidden ? Events.PAUSE : Events.RESUME),
);

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;

  // Clamp dt so a stalled tab doesn't fling the simulation forward.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  estate.update(dt);
  bus.emit(Events.TICK, { dt, elapsed });
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

// Handy for poking at the scene from devtools during the alpha.
if (import.meta.env.DEV) window.__sanctuary = { bus, estate };
