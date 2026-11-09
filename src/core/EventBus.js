/**
 * EventBus — tiny synchronous pub/sub used to decouple game systems.
 *
 * Systems never hold references to each other; they emit and listen to
 * named events instead. Event names live in `Events` so typos fail loudly
 * in one place instead of silently never firing.
 *
 *   import { bus, Events } from './core/EventBus.js';
 *   const off = bus.on(Events.TICK, ({ dt }) => { ... });
 *   bus.emit(Events.TICK, { dt: 0.016 });
 *   off(); // unsubscribe
 */

export const Events = Object.freeze({
  // Engine lifecycle
  BOOT: 'engine:boot',
  READY: 'engine:ready',
  TICK: 'engine:tick', // { dt, elapsed }
  RESIZE: 'engine:resize', // { width, height }
  PAUSE: 'engine:pause',
  RESUME: 'engine:resume',

  // Camera
  CAMERA_MOVED: 'camera:moved', // { target, position }
  CAMERA_RESET: 'camera:reset',

  // World
  ESTATE_BUILT: 'world:estateBuilt', // { zones }
  ZONE_HOVER: 'world:zoneHover', // { zone | null }
  ZONE_SELECT: 'world:zoneSelect', // { zone }

  // Simulation clock
  CLOCK_MINUTE: 'sim:minute', // { day, hour, minute, minuteOfDay, total }
  CLOCK_HOUR: 'sim:hour', // { day, hour }
  CLOCK_DAY: 'sim:day', // { day }
  CLOCK_SPEED: 'sim:speed', // { speed, label, paused }

  // Residents & schedule
  RESIDENTS_SPAWNED: 'residents:spawned', // { residents }
  BLOCK_START: 'schedule:blockStart', // { block, day }
  BLOCK_END: 'schedule:blockEnd', // { block, day, summary }
  ATTENDANCE: 'schedule:attendance', // { resident, block, status: 'onTime' | 'late' | 'missed' }
  FACILITY_STATS: 'facility:stats', // { population, avgComposure, today: { onTime, late, missed } }
});

export class EventBus {
  constructor({ debug = false } = {}) {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this.debug = debug;
  }

  /**
   * Subscribe to an event. Use '*' to receive every event as (name, payload).
   * @returns {() => void} unsubscribe function
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`EventBus.on("${event}") requires a function handler`);
    }
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribe for a single emission. */
  once(event, handler) {
    const off = this.on(event, (payload, name) => {
      off();
      handler(payload, name);
    });
    return off;
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(event);
  }

  /**
   * Emit synchronously. A throwing listener is logged and does not stop
   * the remaining listeners from running.
   */
  emit(event, payload) {
    if (this.debug && event !== Events.TICK && event !== Events.CLOCK_MINUTE) {
      console.debug(`[bus] ${event}`, payload);
    }
    this._dispatch(this._listeners.get(event), payload, event);
    if (event !== '*') this._dispatch(this._listeners.get('*'), payload, event, true);
  }

  _dispatch(set, payload, event, wildcard = false) {
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const handler of [...set]) {
      try {
        wildcard ? handler(event, payload) : handler(payload, event);
      } catch (err) {
        console.error(`[bus] listener for "${event}" threw`, err);
      }
    }
  }

  /** Remove every listener (or every listener for one event). */
  clear(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}

/** Shared singleton for the running game. */
export const bus = new EventBus({ debug: import.meta.env?.DEV ?? false });
