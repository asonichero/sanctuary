/**
 * Composure tuning — pure data. All rates are per game minute on 0–100 stats.
 * Negative composure = loss. See sim/composureRules.js for how they combine.
 */

/** Aura bands: Cool Blue ≥ 70, Amber 30–69, Red < 30. */
export const BANDS = Object.freeze({
  BLUE: { id: 'BLUE', label: 'Cool Blue', min: 70, color: 0x5aa9e6 },
  AMBER: { id: 'AMBER', label: 'Amber', min: 30, color: 0xe6a03c },
  RED: { id: 'RED', label: 'Red', min: 0, color: 0xe0483c },
});
/** A band only changes once composure is this far past the threshold (stops flicker). */
export const BAND_HYSTERESIS = 1.5;

/** QUEUED_RESET clears on its own once composure climbs back to this. */
export const RESET_RECOVERY = 40;

/** Base drift by activity. `static` activities are posture-bound (lineups, holds). */
export const ACTIVITY = Object.freeze({
  alignment: { composure: -0.06, fatigue: 0.06, static: true },
  hold: { composure: -0.08, fatigue: 0.12, static: true },
  work: { composure: -0.03, fatigue: 0.1, static: false },
  assembly: { composure: -0.04, fatigue: 0.03, static: true },
  walking: { composure: 0, fatigue: 0.03, static: false },
  idle: { composure: 0.05, fatigue: -0.05, static: false },
  rest: { composure: 0.2, fatigue: -0.3, static: false },
  stretch: { composure: 0.3, fatigue: -0.9, static: false }, // player-granted stretch break
});

/**
 * Trait multipliers. `loss[activity]` scales composure loss (gains are not
 * scaled); `fatigue[activity]` scales fatigue gain; `staticDefiance` is
 * defiance gained per minute while held in a static activity.
 */
export const TRAIT_DRIFT = Object.freeze({
  SLOUCHER: {
    loss: { alignment: 2.0, hold: 2.4, assembly: 1.8, work: 1.0 },
    fatigue: {},
    fatigueKnee: 40,
    staticDefiance: 0,
  },
  RESTLESS: {
    loss: { alignment: 1.6, hold: 1.5, assembly: 1.8, work: 0.5 },
    fatigue: {},
    fatigueKnee: 40,
    staticDefiance: 0.03,
  },
  OVERACHIEVER: {
    loss: { alignment: 0.6, hold: 0.6, assembly: 0.6, work: 0.6 },
    fatigue: { alignment: 1.7, hold: 1.7, work: 2.0, assembly: 1.4 },
    fatigueKnee: 65, // holds up longer…
    fatigueGain: 3.0, // …then collapses harder
    staticDefiance: 0,
  },
});

/** Tier scaling of composure loss (newcomers wobble more). */
export const TIER_LOSS = Object.freeze({ SLATE: 1.2, OCHRE: 0.9, CHARCOAL: 0 });

/** Fatigue above the trait's knee adds up to this much extra loss at 100 fatigue (trait `fatigueGain` overrides). */
export const FATIGUE_LOSS_GAIN = 1.0;
/** Defiance adds defiance/DEFIANCE_LOSS_DIV to the loss multiplier. */
export const DEFIANCE_LOSS_DIV = 200;

/** Defiance per minute while in the red band, and decay while resting. */
export const DEFIANCE_IN_RED = 0.04;
export const DEFIANCE_REST_DECAY = 0.02;

/** Attendance outcomes. */
export const ATTENDANCE = Object.freeze({
  onTime: { composure: 0.5, defiance: 0 },
  late: { composure: -3, defiance: 2 },
  missed: { composure: -6, defiance: 5 },
});

/** Overnight: fatigue is multiplied, composure pulled toward the tier baseline, defiance decays. */
export const OVERNIGHT = Object.freeze({
  fatigueKeep: 0.25,
  composurePull: 0.7,
  defianceKeep: 0.85,
  baseline: { SLATE: 75, OCHRE: 85, CHARCOAL: 95 },
});
