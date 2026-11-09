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
| `src/core/Random.js` | Seeded RNG (same seed ⇒ same roster and daily plans) |
| `src/content/roster.js` | Roles, tiers (kit colours), traits, states, starting stats — pure data |
| `src/content/timetable.js` | The day window and the block timetable — pure data |
| `src/content/composure.js` | Aura bands and every drift / attendance / overnight rate — pure data |
| `src/world/EstateBuilder.js` | Renderer, lighting, camera rig, the estate blockout and roof cutaways |
| `src/world/NavGraph.js` | Walkable path network, zone sockets (resident slots, staff posts) and route finding |
| `src/sim/SubjectFactory.js` | Procedural residents and staff: low-poly athletic mannequins, `userData` state, posing |
| `src/sim/TimeManager.js` | Game clock: 06:40 muster → 07:00–18:00 day → 18:30 close, then skips to the next morning |
| `src/sim/ScheduleSystem.js` | Zone assignment, socket claiming, waypoint navigation, attendance; publishes `agent.activity` |
| `src/sim/composureRules.js` | Pure composure rules (drift, bands, states); runs in Node |
| `src/sim/ComposureSystem.js` | Applies the rules each frame, emits aura and state changes; sole writer of `stats` |
| `src/ui/Hud.js` | DOM overlay driven by bus events |
| `src/main.js` | Boot and the frame loop |
| `tests/` | `npm test`: rules unit tests and headless multi-day runs (Node, no browser) |

## Agents

Every resident and staff member is a jointed low-poly mannequin in athletic kit (tank top, compression shorts or
leggings, trainers) coloured by tier: **SLATE** newcomers, **OCHRE** intermediates, **CHARCOAL** staff. The core state
sits on `mesh.userData` as plain JSON:

```js
{ id: 'res_001', role: 'RESIDENT', tier: 'SLATE', trait: 'SLOUCHER',
  stats: { composure: 85, fatigue: 15, defiance: 5 },
  state: 'SCHEDULED_TASK', assignedSocket: 'Somatic Studio/slots#07' }
```

## The day

| Time | Block | Zone |
| --- | --- | --- |
| 07:00–09:00 | Morning Alignment (posture lineups) | Alignment Hall |
| 09:30–12:00 | Somatic Work (static holds on mats) | Somatic Studio |
| 12:10–12:50 | Midday Recovery | Residence Wing (staff: Main House) |
| 13:00–16:00 | Groundskeeping (gravel raking) | Sunken Courtyard |
| 16:30–18:00 | Evening Assembly | Assembly Lawn |
| 18:00–18:30 | Dismissal | Residence Wing (staff: Main House) |

Residents take resident slots and staff take the zone's posts, facing the lineup. Arrival at a mandatory block is
on time, late (≤ 15 min) or missed.

## Composure

Composure, fatigue and defiance drift each game minute by activity, trait and tier (`content/composure.js`):

- **Sloucher**: loses alignment roughly twice as fast in lineups, holds and assembly; the spine visibly rounds.
- **Restless**: fine while raking, but frays and builds defiance whenever they're held still.
- **Overachiever**: barely drifts until fatigue passes 65, then drops hard.

Newcomers wobble more than intermediates. Fatigue and defiance amplify losses, and rest recovers them. Overnight,
fatigue mostly clears and composure is pulled back toward the tier baseline.

The aura ring under each resident shows the band: **Cool Blue** ≥ 70, **Amber** 30–69, **Red** < 30 (flashing). Bands
change with a small hysteresis so values sitting on a threshold don't flicker. A resident who reaches Red moves to
`QUEUED_RESET` (an intervention is needed) and returns to `SCHEDULED_TASK` on their own if they recover to 40.
`IN_SITU_CORRECTION` is defined (drift freezes in it) but no system enters it yet.

## Camera

LMB drag orbit · RMB drag pan · wheel zoom (to cursor) · WASD move focus · Q/E rotate · F reset. Roofs fade out when you
focus on the zone beneath them.

## Simulation

Space pauses, 1–3 set speed (1×, 3×, 10× game minutes per second). Append `?seed=anything` to the URL to generate a
different roster. `npm test` runs the rules and headless day tests.
