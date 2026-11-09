/**
 * Seeded RNG (mulberry32). Every procedural system takes one of these so a
 * given seed always produces the same estate, residents and daily plans.
 */
export class Random {
  constructor(seed = 1) {
    this.seed = Random.hash(seed);
    this._state = this.seed;
  }

  /** Stable 32-bit hash for numbers or strings. */
  static hash(value) {
    const str = String(value);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Independent child stream, e.g. rng.fork('names'). */
  fork(label) {
    return new Random(`${this.seed}:${label}`);
  }

  float() {
    let t = (this._state = (this._state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.float();
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p) {
    return this.float() < p;
  }

  pick(list) {
    return list[Math.floor(this.float() * list.length)];
  }

  /** Weighted pick from [{ value, weight }]. */
  weighted(entries) {
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    let r = this.float() * total;
    for (const e of entries) {
      r -= Math.max(0, e.weight);
      if (r <= 0) return e.value;
    }
    return entries[entries.length - 1].value;
  }

  /** Normal distribution (Box–Muller). */
  gaussian(mean = 0, sd = 1) {
    const u = 1 - this.float();
    const v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Trait-style value in [0, 1], clustered around `mean`. */
  trait(mean = 0.5, sd = 0.18) {
    return Math.min(1, Math.max(0, this.gaussian(mean, sd)));
  }

  shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
