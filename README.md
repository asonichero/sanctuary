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
| `src/content/interactions.js` | Player actions (patrol check, radial options), cooldowns, range — pure data |
| `src/world/EstateBuilder.js` | Renderer, lighting, eye-level camera, the estate (walkable atrium and residence) |
| `src/world/WorldColliders.js` | 2D walk collision, floor heights and the perimeter for the player — pure math |
| `src/world/NavGraph.js` | Walkable path network, zone sockets (beds, slots, staff posts) and route finding |
| `src/player/FirstPersonController.js` | Pointer-lock mouse look, WASD walking, collision and step-up |
| `src/player/Interaction.js` | Crosshair raycast targeting, patrol check (LMB), radial menu (RMB) |
| `src/ui/RadialMenu.js` | The four-way radial menu around the crosshair |
| `src/sim/SubjectFactory.js` | Procedural residents and staff: low-poly athletic mannequins, `userData` state, posing |
| `src/sim/TimeManager.js` | Game clock: 06:40 muster → 07:00–18:00 day → 18:30 close, then skips to the next morning |
| `src/sim/ScheduleSystem.js` | Zone assignment, socket claiming, navigation, attendance, stretch / send-to-rest; publishes `agent.activity` |
| `src/sim/interactionRules.js` | Pure interaction rules (cooldowns, why an action is unavailable, stat effects) |
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

## Playing (first person)

You walk the estate at eye level. Click the view to take the mouse (Esc lets it go).

| Input | Action |
| --- | --- |
| WASD / arrows, Shift | Walk, sprint |
| Mouse | Look |
| LMB on someone in front of you | **Patrol check**: they turn to you; +2 composure (once per 30 game min); staff check in |
| Hold RMB on a resident | **Radial menu**: move toward an option, release to choose (release in the middle cancels) |
| RMB on staff | Inspect |
| I · Tab | Unpin the inspected card · toggle the roster |
| Space · 1–3 | Pause · sim speed (walking stays real-time) |

The crosshair ray reaches 6 units (about arm's length plus a step) and stops at the first thing it hits, so walls and
columns block targeting. A ring on the crosshair and a marker over their head show who you're looking at, with a live
card underneath.

Radial options (residents): **Inspect** (pin their card), **Encourage** (+8 composure, −3 defiance; 60 min cooldown),
**Stretch break** (10 min in place: fatigue falls, composure lifts; 45 min cooldown), **Send to rest** (back to
their bed until the current block ends, or the next one if you send them between blocks; the block counts as
excused, not missed). Unavailable options are dimmed with the reason.

The **Main House** is a glass-and-stone atrium you can walk into; staff work behind the reception desk. The
**Residence Wing** has a central hallway with four rooms either side and three beds per room. Residents sit on their
beds before and after the day and during Midday Recovery.

## Simulation

Space pauses, 1–3 set speed (1×, 3×, 10× game minutes per second). Append `?seed=anything` to the URL to generate a
different roster. `npm test` runs the rules and headless day tests.
