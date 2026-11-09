/**
 * Player interactions — pure data.
 *
 * Left-click on an agent in front of you is a patrol check. Right-click opens
 * the radial menu (residents only), laid out clockwise from the top.
 * Cooldowns and durations are in game minutes; stat changes are one-off.
 */

/** How close (world units) an agent must be to be targeted by the crosshair. */
export const INTERACT_RANGE = 6;

export const ACTIONS = Object.freeze({
  check: {
    id: 'check', label: 'Patrol check', cooldown: 30, composure: 2, defiance: 0,
    hint: 'A word in passing: +2 composure (once per 30 min)',
  },
  inspect: { id: 'inspect', label: 'Inspect', glyph: '◎', hint: 'Pin their details on screen' },
  encourage: {
    id: 'encourage', label: 'Encourage', glyph: '✦', cooldown: 60, composure: 8, defiance: -3,
    hint: '+8 composure, −3 defiance',
  },
  stretch: {
    id: 'stretch', label: 'Stretch break', glyph: '↟', cooldown: 45, duration: 10,
    hint: '10 min stretch in place: fatigue falls, composure lifts',
  },
  rest: { id: 'rest', label: 'Send to rest', glyph: '☾', hint: 'Back to their room until this block ends' },
});

/** Radial order: top, right, bottom, left. */
export const RADIAL = Object.freeze(['inspect', 'encourage', 'rest', 'stretch']);
