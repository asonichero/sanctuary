import { ACTIONS } from '../content/interactions.js';

const DEAD_ZONE = 18; // px of virtual cursor travel before an option highlights
const MAX_R = 90;

/**
 * RadialMenu — four-way menu drawn around the crosshair. The mouse stays
 * captured; Interaction feeds raw mouse movement into `move`, which steers a
 * virtual cursor and highlights the option in that direction.
 */
export class RadialMenu {
  constructor(root) {
    this.root = root;
    this.cursor = { x: 0, y: 0 };
    this.options = [];
    this.highlight = -1;
    root.innerHTML = `
      <div class="radial-ring"></div>
      <div class="radial-center"><p class="radial-name"></p><p class="radial-hint"></p></div>
      <div class="radial-dot"></div>
      ${[0, 1, 2, 3].map((i) => `<div class="radial-item" data-slot="${i}"><span class="radial-glyph"></span><span class="radial-label"></span><span class="radial-note"></span></div>`).join('')}`;
    this.items = [...root.querySelectorAll('.radial-item')];
    this.nameEl = root.querySelector('.radial-name');
    this.hintEl = root.querySelector('.radial-hint');
    this.dotEl = root.querySelector('.radial-dot');
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(agent, options) {
    this.cursor = { x: 0, y: 0 };
    this.highlight = -1;
    this.nameEl.textContent = agent.name;
    this.refresh(options);
    this._render();
    this.root.hidden = false;
  }

  /** Update availability (cooldowns tick while the menu is open). */
  refresh(options) {
    this.options = options;
    options.forEach((o, i) => {
      const el = this.items[i];
      const def = ACTIONS[o.id];
      el.querySelector('.radial-glyph').textContent = def.glyph;
      el.querySelector('.radial-label').textContent = def.label;
      el.querySelector('.radial-note').textContent = o.blocked ?? '';
      el.classList.toggle('is-blocked', !!o.blocked);
    });
    this._render();
  }

  move(dx, dy) {
    this.cursor.x += dx;
    this.cursor.y += dy;
    const r = Math.hypot(this.cursor.x, this.cursor.y);
    if (r > MAX_R) {
      this.cursor.x *= MAX_R / r;
      this.cursor.y *= MAX_R / r;
    }
    if (r < DEAD_ZONE) this.highlight = -1;
    else {
      // 0 = up, 1 = right, 2 = down, 3 = left
      const a = Math.atan2(this.cursor.x, -this.cursor.y); // 0 at up, clockwise
      this.highlight = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
    }
    this._render();
  }

  _render() {
    this.items.forEach((el, i) => el.classList.toggle('is-active', i === this.highlight));
    const o = this.options[this.highlight];
    this.hintEl.textContent = o ? o.blocked ?? ACTIONS[o.id].hint : 'Move toward an action · release to choose';
    this.dotEl.style.transform = `translate(${this.cursor.x * 0.6}px, ${this.cursor.y * 0.6}px)`;
  }

  /** Hide and return the highlighted option ({ id, blocked }) or null. */
  close() {
    const choice = this.options[this.highlight] ?? null;
    this.root.hidden = true;
    return choice;
  }
}
