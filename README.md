# Sanctuary: Wellness & Composure

Low-poly management simulation built with Vite, Three.js and Tailwind CSS.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/core/EventBus.js` | Pub/sub bus and the `Events` name registry; systems talk only through it |
| `src/world/EstateBuilder.js` | Renderer, studio lighting, camera rig and the estate blockout (zones) |
| `src/world/NavGraph.js` | Walkable path network, zone slots and route finding |
| `src/core/Random.js` | Seeded RNG (same seed ⇒ same roster and daily plans) |
| `src/sim/SimClock.js` | Game time, speed control, minute/hour/day events |
| `src/sim/SubjectFactory.js` | Procedural residents: identity, traits, needs, low-poly mesh |
| `src/sim/ScheduleSystem.js` | Daily timetable, departures, attendance, needs and composure |
| `src/ui/Hud.js` | DOM overlay driven by bus events |
| `src/main.js` | Boot and the frame loop (emits `engine:tick`) |
| `src/style.css` | Tailwind entry and HUD styles |

## Camera

LMB drag orbit · RMB drag pan · wheel zoom (to cursor) · WASD move focus · Q/E rotate · F reset.

## Simulation

Space pauses, 1–3 set speed (1×, 3×, 10× game minutes per second; nights run 8× faster).
Append `?seed=anything` to the URL to generate a different roster.
