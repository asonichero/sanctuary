/**
 * Roster content — pure data, no three.js or bus imports, so rules and tests
 * can load it in Node.
 */

export const ROLES = Object.freeze({ RESIDENT: 'RESIDENT', STAFF: 'STAFF' });

/** Kit colours by tier: `top` is the tank top, `lower` the shorts/leggings, `trim` the shoes. */
export const TIERS = Object.freeze({
  SLATE: { id: 'SLATE', label: 'Newcomer', top: 0x6c7a89, lower: 0x3f4852, trim: 0xd9dde1 },
  OCHRE: { id: 'OCHRE', label: 'Intermediate', top: 0xc8913f, lower: 0x6e4f26, trim: 0xefe3cc },
  CHARCOAL: { id: 'CHARCOAL', label: 'Staff', top: 0x3b3d40, lower: 0x222326, trim: 0x8d9196 },
});

/**
 * Behavioural traits. `punctuality` (0–1) feeds departure timing; the drift
 * multipliers that make each trait behave differently live in content/composure.js.
 */
export const TRAITS = Object.freeze({
  SLOUCHER: { id: 'SLOUCHER', label: 'Sloucher', punctuality: 0.4, blurb: 'Loses alignment fast in static work.' },
  RESTLESS: { id: 'RESTLESS', label: 'Restless', punctuality: 0.5, blurb: 'Fine on the move; frays and pushes back when held still.' },
  OVERACHIEVER: { id: 'OVERACHIEVER', label: 'Overachiever', punctuality: 0.85, blurb: 'Steady until fatigue catches up, then drops hard.' },
});

/**
 * Agent states. Schedule-driven work is the default; QUEUED_RESET flags a
 * resident whose composure has collapsed. IN_SITU_CORRECTION is reserved for
 * the intervention step and is not entered by any system yet.
 */
export const STATES = Object.freeze({
  SCHEDULED_TASK: 'SCHEDULED_TASK',
  IN_SITU_CORRECTION: 'IN_SITU_CORRECTION',
  QUEUED_RESET: 'QUEUED_RESET',
});

/** Starting stat ranges by tier: [min, max]. */
export const STARTING_STATS = Object.freeze({
  SLATE: { composure: [70, 88], fatigue: [8, 22], defiance: [6, 18] },
  OCHRE: { composure: [80, 95], fatigue: [5, 15], defiance: [0, 8] },
  CHARCOAL: { composure: [92, 100], fatigue: [0, 8], defiance: [0, 0] },
});

/** Share of residents generated as newcomers (the rest are intermediate). */
export const NEWCOMER_SHARE = 0.6;

export const FIRST_NAMES = [
  'Ada', 'Bram', 'Celia', 'Dorian', 'Elise', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonah',
  'Kira', 'Leon', 'Mara', 'Nico', 'Odile', 'Pascal', 'Quinn', 'Rosa', 'Silas', 'Tess',
  'Ulric', 'Vera', 'Wren', 'Xavi', 'Yara', 'Zane', 'Alba', 'Cyrus', 'Delphine', 'Emil',
];
export const LAST_NAMES = [
  'Ashdown', 'Bellweather', 'Calloway', 'Dunmore', 'Everly', 'Fairhurst', 'Garrow', 'Hartwell',
  'Ingram', 'Jessop', 'Kestrel', 'Lockwood', 'Marlowe', 'Northcott', 'Oakley', 'Penhallow',
  'Quarles', 'Ravenscroft', 'Sutherby', 'Thorne', 'Underhill', 'Vane', 'Whitlock', 'Yardley',
];

export const SKIN_TONES = [0xf1d3b8, 0xe0b48f, 0xc68d65, 0x9c6a47, 0x6e4a33, 0xf5dcc8];
