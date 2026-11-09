import { bus, Events } from '../core/EventBus.js';
import { DAY, blockAt, nextBlock } from '../content/timetable.js';

export const MINUTES_PER_DAY = 24 * 60;

/** Selectable speeds: game minutes per real second. */
export const SPEEDS = Object.freeze([
  { label: 'Paused', rate: 0 },
  { label: '1×', rate: 1 },
  { label: '3×', rate: 3 },
  { label: '10×', rate: 10 },
]);

/**
 * TimeManager — the simulation clock for the working day.
 *
 * Converts real frame time into game minutes and announces every whole
 * minute and hour it crosses, in order, on the bus. Each day runs from
 * DAY.open (06:40, residents muster) to DAY.close (18:30, dismissal done);
 * at close the clock jumps straight to the next morning and emits CLOCK_DAY.
 * The blocks themselves (Morning Alignment, Somatic Work, …) are timetable
 * data; `block` / `next` expose the current and upcoming ones.
 */
export class TimeManager {
  constructor({ day = 1, minuteOfDay = DAY.open, speedIndex = 1 } = {}) {
    this.total = (day - 1) * MINUTES_PER_DAY + minuteOfDay; // fractional game minutes
    this.speedIndex = speedIndex;
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
  get rate() {
    return SPEEDS[this.speedIndex].rate;
  }
  /** 'muster' before 07:00, 'day' during the working day, 'dismissal' after 18:00. */
  get phase() {
    const m = this.minuteOfDay;
    return m < DAY.start ? 'muster' : m < DAY.end ? 'day' : 'dismissal';
  }
  /** Fraction of the working day (07:00–18:00) elapsed, clamped to 0–1. */
  get dayProgress() {
    return Math.min(1, Math.max(0, (this.minuteOfDay - DAY.start) / (DAY.end - DAY.start)));
  }
  get block() {
    return blockAt(this.minuteOfDay);
  }
  get next() {
    return nextBlock(this.minuteOfDay);
  }

  setSpeed(index) {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    if (this.speedIndex > 0) this._resumeIndex = this.speedIndex;
    bus.emit(Events.CLOCK_SPEED, { speed: this.speedIndex, label: SPEEDS[this.speedIndex].label, paused: this.paused });
  }

  togglePause() {
    this.setSpeed(this.paused ? this._resumeIndex ?? 1 : 0);
  }

  /** Advance by `dtReal` seconds. Returns elapsed game minutes this frame. */
  update(dtReal) {
    const dGame = dtReal * this.rate;
    if (dGame <= 0) return 0;
    return this.advance(dGame);
  }

  /** Advance by game minutes (also used by tests and fast-forward). */
  advance(dGame) {
    const before = this.total;
    this.total += dGame;
    const whole = Math.floor(this.total);
    for (let m = this._lastWhole + 1; m <= whole; m++) {
      this._announce(m);
      if (m % MINUTES_PER_DAY >= DAY.close) {
        // Day over: skip the night and open tomorrow.
        this._jumpToNextMorning(m);
        return Math.max(0, m - before); // the skipped night is not simulated
      }
    }
    this._lastWhole = whole;
    return dGame;
  }

  _jumpToNextMorning(closingMinute) {
    const nextDay = Math.floor(closingMinute / MINUTES_PER_DAY) + 1; // zero-based
    this.total = nextDay * MINUTES_PER_DAY + DAY.open;
    this._lastWhole = this.total - 1;
    bus.emit(Events.CLOCK_DAY, { day: nextDay + 1 });
    this._announce(this.total);
    this._lastWhole = this.total;
  }

  _announce(total) {
    const day = Math.floor(total / MINUTES_PER_DAY) + 1;
    const minuteOfDay = total % MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    bus.emit(Events.CLOCK_MINUTE, { day, hour, minute, minuteOfDay, total });
    if (minute === 0) bus.emit(Events.CLOCK_HOUR, { day, hour });
  }

  static format(minuteOfDay) {
    const m = Math.floor(minuteOfDay) % MINUTES_PER_DAY;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}
