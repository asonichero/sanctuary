import { bus, Events } from '../core/EventBus.js';
import { TimeManager, SPEEDS } from '../sim/TimeManager.js';
import { TIERS, TRAITS } from '../content/roster.js';
import { BANDS } from '../content/composure.js';
import { ACTIONS } from '../content/interactions.js';

const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x)}%`;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const BAND_CSS = Object.fromEntries(Object.values(BANDS).map((b) => [b.id, hex(b.color)]));
const STATUS_STYLE = { onTime: 'text-emerald-300', late: 'text-amber-300', missed: 'text-rose-300' };
const STATUS_LABEL = { onTime: 'on time', late: 'late', missed: 'missed' };
const STATE_SHORT = { SCHEDULED_TASK: 'task', QUEUED_RESET: 'queued', IN_SITU_CORRECTION: 'in situ' };
const PHASE_LABEL = { muster: 'Muster', day: '', dismissal: 'Dismissal' };

/**
 * Hud — DOM overlay. Reads from the bus and the systems; never mutates
 * simulation state except through the clock's speed controls.
 */
export class Hud {
  constructor({ clock, schedule, composure }) {
    this.clock = clock;
    this.schedule = schedule;
    this.composure = composure;
    this.el = Object.fromEntries(
      ['day', 'clock', 'phase', 'progress', 'speeds', 'block', 'next', 'pop', 'staff', 'composure', 'composure-bar',
        'meters', 'bands', 'queued', 'attendance', 'log', 'roster', 'roster-panel', 'patrols', 'pinned', 'target',
        'toasts'].map((k) => [k, $(`hud-${k}`)]),
    );
    this.el.crosshair = $('crosshair');
    this.el.lockPrompt = $('lock-prompt');
    this.target = null;
    this.pinned = null;

    this._buildSpeedButtons();
    this._bindKeys();

    bus.on(Events.CLOCK_SPEED, () => this._renderSpeeds());
    bus.on(Events.FACILITY_STATS, (s) => this._renderStats(s));
    bus.on(Events.ATTENDANCE, (e) => this._onAttendance(e));
    bus.on(Events.BLOCK_START, ({ block }) => this._log(`${block.label} begins`, 'text-stone-300'));
    bus.on(Events.CLOCK_DAY, ({ day }) => this._log(`— Day ${day} —`, 'text-amber-200'));
    bus.on(Events.AURA_CHANGED, ({ agent, from, to }) => {
      if (to === 'RED') this._log(`${agent.name} composure critical`, 'text-rose-300');
      else if (from === 'RED') this._log(`${agent.name} steadied (${BANDS[to].label})`, 'text-sky-300');
    });
    bus.on(Events.TARGET_CHANGED, ({ agent }) => (this.target = agent));
    bus.on(Events.POINTER_LOCK, ({ locked }) => this.el.lockPrompt.classList.toggle('is-hidden', locked));
    bus.on(Events.RADIAL_OPEN, () => (this.el.target.hidden = true));
    bus.on(Events.INTERACT, ({ action, agent }) => {
      if (action === 'inspect') {
        this.pinned = agent;
        this._toast(`Pinned ${agent.name}`);
      }
    });
    bus.on(Events.INTERACT_RESULT, ({ action, agent, ok, message }) => {
      this._toast(message, !ok);
      if (ok && action !== 'check') this._log(`${ACTIONS[action].label} · ${agent.name}`, 'text-emerald-200');
    });
    bus.on(Events.STATE_CHANGED, ({ agent, to }) => {
      if (to === 'QUEUED_RESET') this._log(`${agent.name} queued for reset`, 'text-rose-200');
      else if (to === 'SCHEDULED_TASK') this._log(`${agent.name} back on schedule`, 'text-stone-400');
    });

    this._rosterTimer = 0;
    this._renderStats(composure.stats());
  }

  _buildSpeedButtons() {
    this.el.speeds.innerHTML = '';
    SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i === 0 ? '❚❚' : s.label;
      b.title = `${s.label} (${i === 0 ? 'Space' : i})`;
      b.className = 'speed-btn';
      b.addEventListener('click', () => this.clock.setSpeed(i));
      this.el.speeds.appendChild(b);
    });
    this._renderSpeeds();
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.clock.togglePause();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        this.el['roster-panel'].classList.toggle('hidden');
      } else if (e.code === 'KeyI') {
        this.pinned = null;
      } else if (['1', '2', '3'].includes(e.key)) {
        this.clock.setSpeed(Number(e.key));
      }
    });
  }

  _renderSpeeds() {
    [...this.el.speeds.children].forEach((b, i) => b.classList.toggle('is-active', i === this.clock.speedIndex));
  }

  _renderStats(s) {
    const band = s.avg.composure >= 70 ? 'BLUE' : s.avg.composure >= 30 ? 'AMBER' : 'RED';
    this.el.pop.textContent = s.population;
    this.el.staff.textContent = s.staff;
    this.el.composure.textContent = pct(s.avg.composure);
    this.el['composure-bar'].style.width = pct(s.avg.composure);
    this.el['composure-bar'].style.backgroundColor = BAND_CSS[band];

    this.el.meters.innerHTML = [['fatigue', s.avg.fatigue], ['defiance', s.avg.defiance]]
      .map(
        ([k, v]) => `<div class="flex items-center gap-2">
          <span class="w-14 capitalize text-stone-400">${k}</span>
          <span class="h-1.5 flex-1 rounded bg-white/10"><span class="block h-full rounded bg-stone-300/70" style="width:${pct(v)}"></span></span>
          <span class="w-8 text-right font-mono text-stone-400">${Math.round(v)}</span>
        </div>`,
      )
      .join('');

    this.el.bands.innerHTML = Object.values(BANDS)
      .map((b) => `<span class="aura-chip" style="--c:${BAND_CSS[b.id]}">${s.bands[b.id]} ${b.label}</span>`)
      .join('');
    this.el.queued.textContent = s.queued ? `${s.queued} queued for reset` : 'none queued';
    this.el.queued.className = s.queued ? 'text-rose-300' : 'text-stone-500';
    this.el.patrols.textContent = s.patrolChecks;
    this._renderAttendance();
  }

  _renderAttendance() {
    const t = this.schedule.today;
    this.el.attendance.innerHTML = `<span class="${STATUS_STYLE.onTime}">${t.onTime} on time</span> ·
      <span class="${STATUS_STYLE.late}">${t.late} late</span> ·
      <span class="${STATUS_STYLE.missed}">${t.missed} missed</span>`;
  }

  _onAttendance({ resident, block, status }) {
    this._renderAttendance();
    if (status === 'onTime') return; // keep the log for exceptions
    this._log(`${resident.name} ${STATUS_LABEL[status]} · ${block.label}`, STATUS_STYLE[status]);
  }

  _log(text, cls) {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = `${TimeManager.format(this.clock.minuteOfDay)}  ${text}`;
    this.el.log.prepend(li);
    while (this.el.log.children.length > 40) this.el.log.lastChild.remove();
  }

  _toast(text, bad = false) {
    const li = document.createElement('li');
    li.textContent = text;
    if (bad) li.className = 'is-bad';
    this.el.toasts.prepend(li);
    setTimeout(() => li.remove(), 3300);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
  }

  /** Detail card for an agent (target card and pinned card share it). */
  _card(a, { hint = false } = {}) {
    const { stats, tier, trait, state, role } = a.sim;
    const staff = role === 'STAFF';
    const bar = (label, v, color) => `<div class="flex items-center gap-2">
        <span class="w-16 text-stone-400">${label}</span>
        <span class="h-1.5 flex-1 rounded bg-white/10"><span class="block h-full rounded" style="width:${pct(v)};background:${color}"></span></span>
        <span class="w-6 text-right font-mono text-stone-300">${Math.round(v)}</span></div>`;
    const where = a.path.length ? `→ ${a.placement.zone}` : a.placement.zone;
    return `<div class="flex items-baseline justify-between gap-3">
        <span class="text-sm text-stone-100"><span class="tier-dot" style="--c:${hex(TIERS[tier].top)}"></span>${a.name}</span>
        <span class="font-mono text-[10px] text-stone-500">${a.id}</span></div>
      <p class="text-stone-400">${staff ? 'Staff' : `${TIERS[tier].label} · ${TRAITS[trait].label}`} · ${where}</p>
      ${staff ? '' : `<div class="mt-1.5 space-y-1">
        ${bar('Composure', stats.composure, BAND_CSS[a.band])}
        ${bar('Fatigue', stats.fatigue, '#a8a29e')}
        ${bar('Defiance', stats.defiance, '#a8a29e')}</div>
      <p class="mt-1 ${state === 'SCHEDULED_TASK' ? 'text-stone-500' : 'text-rose-300'}">${STATE_SHORT[state]} · ${a.activity}</p>`}
      ${hint ? `<p class="mt-1.5 text-[10px] text-stone-500"><kbd>LMB</kbd> check${staff ? ' · <kbd>RMB</kbd> inspect' : ' · hold <kbd>RMB</kbd> actions'}</p>` : ''}`;
  }

  _renderTarget() {
    const t = this.target;
    this.el.crosshair.classList.toggle('has-target', !!t);
    this.el.crosshair.style.setProperty('--c', t && t.sim.role === 'RESIDENT' ? BAND_CSS[t.band] : '#e7e5e4');
    const radialOpen = !$('radial').hidden;
    this.el.target.hidden = !t || radialOpen;
    if (t && !radialOpen) this.el.target.innerHTML = this._card(t, { hint: true });
    this.el.pinned.hidden = !this.pinned;
    if (this.pinned) this.el.pinned.innerHTML = `<p class="mb-1 text-[10px] uppercase tracking-wider text-stone-500">Pinned · <kbd>I</kbd> to unpin</p>${this._card(this.pinned)}`;
  }

  _renderRoster() {
    const rows = [...this.schedule.residents]
      .sort((a, b) => a.sim.stats.composure - b.sim.stats.composure)
      .map((r) => {
        const { stats, tier, trait, state } = r.sim;
        const where = r.path.length ? `→ ${r.placement.zone}` : r.placement.zone;
        return `<tr class="border-t border-white/5" title="${TRAITS[trait].blurb}">
          <td class="py-0.5 pr-2 text-stone-200 whitespace-nowrap"><span class="tier-dot" style="--c:${hex(TIERS[tier].top)}"></span>${r.name}</td>
          <td class="pr-2 text-stone-500">${TRAITS[trait].label}</td>
          <td class="pr-2 text-stone-400 truncate max-w-[8rem]">${where}</td>
          <td class="pr-2 ${state === 'SCHEDULED_TASK' ? 'text-stone-500' : 'text-rose-300'}">${STATE_SHORT[state]}</td>
          <td class="pr-2 text-right font-mono text-stone-400" title="fatigue">${Math.round(stats.fatigue)}</td>
          <td class="text-right font-mono" style="color:${BAND_CSS[r.band]}" title="composure">${Math.round(stats.composure)}</td>
        </tr>`;
      })
      .join('');
    this.el.roster.innerHTML = rows;
  }

  /** Called every frame; cheap text updates only. */
  update(dtReal) {
    const c = this.clock;
    this.el.clock.textContent = TimeManager.format(c.minuteOfDay);
    this.el.day.textContent = c.day;
    this.el.phase.textContent = PHASE_LABEL[c.phase];
    this.el.progress.style.width = pct(c.dayProgress * 100);
    const block = c.block;
    this.el.block.textContent = block ? `${block.label} · ${block.zone}` : 'Transition';
    if (this.target !== this._shownTarget) {
      this._shownTarget = this.target;
      this._renderTarget(); // respond to the crosshair immediately
    }
    this.el.next.textContent = `Next: ${c.next.label} · ${TimeManager.format(c.next.start)}`;

    this._rosterTimer -= dtReal;
    if (this._rosterTimer <= 0) {
      this._rosterTimer = 0.25;
      this._renderTarget();
      if (!this.el['roster-panel'].classList.contains('hidden')) this._renderRoster();
    }
  }
}
