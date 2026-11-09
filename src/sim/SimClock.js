import { bus, Events } from '../core/EventBus.js';

export const MINUTES_PER_DAY = 24 * 60;

/** Selectable speeds: game minutes per real second. */
export const SPEEDS = Object.freeze([
  { label: 'Paused', rate: 0 },
  { label: '1×', rate: 1 },
  { label: '3×', rate: 3 },
  { label: '10×', rate: 10 },
]);

/**
 * SimClock — converts real frame time into game minutes and announces
 * every whole minute, hour and day it crosses, in order, on the bus.
 *
 * Night (22:00–05:45) runs `nightBoost` times faster so the player isn't
 * waiting through hours where residents are asleep.
 */
export class SimClock {
  constructor({ day = 1, minuteOfDay = 6 * 60, speedIndex = 1, nightBoost = 8 } = {}) {
    this.total = (day - 1) * MINUTES_PER_DAY + minuteOfDay; // fractional game minutes
    this.speedIndex = speedIndex;
    this.nightBoost = nightBoost;
    this._lastWhole = Math.floor(this.total);
  }

  get day() {
    return Math.floor(this.total / MINUTES_PER_DAY) + 1;
  }
  get minuteOfDay() {
    return this.total % MINUTES_PER_DAY;
  }
  get hours() {
    return this.minuteOfDay / 60;
  }
  get paused() {
    return SPEEDS[this.speedIndex].rate === 0;
  }
  get isNight() {
    const m = this.minuteOfDay;
    return m >= 22 * 60 || m < 5 * 60 + 45;
  }
  /** Current effective rate in game minutes per real second. */
  get rate() {
    const base = SPEEDS[this.speedIndex].rate;
    return this.isNight ? base * this.nightBoost : base;
  }

  setSpeed(index) {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    if (this.speedIndex > 0) this._resumeIndex = this.speedIndex;
    bus.emit(Events.CLOCK_SPEED, { speed: this.speedIndex, label: SPEEDS[this.speedIndex].label, paused: this.paused });
  }

  togglePause() {
    this.setSpeed(this.paused ? this._resumeIndex ?? 1 : 0);
  }

  /**
   * Advance by `dtReal` seconds. Returns elapsed game minutes this frame.
   */
  update(dtReal) {
    const dGame = dtReal * this.rate;
    if (dGame <= 0) return 0;
    this.total += dGame;

    const whole = Math.floor(this.total);
    for (let m = this._lastWhole + 1; m <= whole; m++) this._announce(m);
    this._lastWhole = whole;
    return dGame;
  }

  _announce(total) {
    const day = Math.floor(total / MINUTES_PER_DAY) + 1;
    const minuteOfDay = total % MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    bus.emit(Events.CLOCK_MINUTE, { day, hour, minute, minuteOfDay, total });
    if (minute === 0) bus.emit(Events.CLOCK_HOUR, { day, hour });
    if (minuteOfDay === 0) bus.emit(Events.CLOCK_DAY, { day });
  }

  static format(minuteOfDay) {
    const m = Math.floor(minuteOfDay) % MINUTES_PER_DAY;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}
