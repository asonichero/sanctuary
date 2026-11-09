/**
 * The daily loop. Pure data.
 *
 * The working day runs 07:00–18:00. The clock opens each day at 06:40 so
 * residents can walk to the first block, and closes at 18:30 once dismissal
 * has sent everyone home; the night is skipped.
 */

export const hm = (h, m = 0) => h * 60 + m;

export const DAY = Object.freeze({
  open: hm(6, 40), // clock starts here each morning
  start: hm(7), // first block
  end: hm(18), // last block ends
  close: hm(18, 30), // clock jumps to the next morning
});

/**
 * Blocks. `zone` is where residents go, `staffZone` overrides it for staff
 * (default: same zone, at the staff posts). `kind` is the activity the
 * composure rules read. Gaps between blocks are transitions.
 */
export const TIMETABLE = Object.freeze([
  { id: 'alignment', label: 'Morning Alignment', start: hm(7), end: hm(9), zone: 'Alignment Hall', kind: 'alignment', mandatory: true },
  { id: 'somatic', label: 'Somatic Work', start: hm(9, 30), end: hm(12), zone: 'Somatic Studio', kind: 'hold', mandatory: true },
  { id: 'midday', label: 'Midday Recovery', start: hm(12, 10), end: hm(12, 50), zone: 'Residence Wing', staffZone: 'Main House', kind: 'rest' },
  { id: 'grounds', label: 'Groundskeeping', start: hm(13), end: hm(16), zone: 'Sunken Courtyard', kind: 'work', mandatory: true },
  { id: 'assembly', label: 'Evening Assembly', start: hm(16, 30), end: hm(18), zone: 'Assembly Lawn', kind: 'assembly', mandatory: true },
  { id: 'dismissal', label: 'Dismissal', start: hm(18), end: hm(18, 30), zone: 'Residence Wing', staffZone: 'Main House', kind: 'rest' },
]);

/** Minutes after a mandatory block starts that still count as late rather than missed. */
export const LATE_GRACE = 15;

/** Block active at a minute of day, or null during transitions. */
export const blockAt = (minuteOfDay) => TIMETABLE.find((b) => minuteOfDay >= b.start && minuteOfDay < b.end) ?? null;

/** Next block starting strictly after `minuteOfDay` (wraps to tomorrow's first). */
export const nextBlock = (minuteOfDay) => TIMETABLE.find((b) => b.start > minuteOfDay) ?? TIMETABLE[0];
