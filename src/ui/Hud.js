import { bus, Events } from '../core/EventBus.js';
import { SimClock, SPEEDS } from '../sim/SimClock.js';
import { COHORTS } from '../sim/SubjectFactory.js';

const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x)}%`;
const STATUS_STYLE = {
  onTime: 'text-emerald-300',
  late: 'text-amber-300',
  missed: 'text-rose-300',
};
const STATUS_LABEL = { onTime: 'on time', late: 'late', missed: 'missed' };
const cohortName = Object.fromEntries(COHORTS.map((c) => [c.id, c.name]));

/**
 * Hud — DOM overlay. Reads from the bus only; never mutates simulation state
 * except through the clock's speed controls.
 */
export class Hud {
  constructor({ clock, schedule }) {
    this.clock = clock;
    this.schedule = schedule;
    this.el = {
      day: $('hud-day'),
      clock: $('hud-clock'),
      night: $('hud-night'),
      speeds: $('hud-speeds'),
      block: $('hud-block'),
      next: $('hud-next'),
      pop: $('hud-pop'),
      composure: $('hud-composure'),
      composureBar: $('hud-composure-bar'),
      needs: $('hud-needs'),
      attendance: $('hud-attendance'),
      log: $('hud-log'),
      roster: $('hud-roster'),
    };

    this._buildSpeedButtons();
    this._bindKeys();

    bus.on(Events.CLOCK_SPEED, () => this._renderSpeeds());
    bus.on(Events.FACILITY_STATS, (s) => this._renderStats(s));
    bus.on(Events.ATTENDANCE, (e) => this._onAttendance(e));
    bus.on(Events.BLOCK_START, ({ block }) => this._log(`${block.label} begins`, 'text-stone-300'));
    bus.on(Events.CLOCK_DAY, ({ day }) => this._log(`— Day ${day} —`, 'text-amber-200'));

    this._rosterTimer = 0;
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
      } else if (['1', '2', '3'].includes(e.key)) {
        this.clock.setSpeed(Number(e.key));
      }
    });
  }

  _renderSpeeds() {
    [...this.el.speeds.children].forEach((b, i) => b.classList.toggle('is-active', i === this.clock.speedIndex));
  }

  _renderStats(s) {
    this.el.pop.textContent = s.population;
    this.el.composure.textContent = pct(s.avgComposure);
    this.el.composureBar.style.width = pct(s.avgComposure);
    this.el.composureBar.style.backgroundColor = `hsl(${(s.avgComposure / 100) * 120}, 45%, 50%)`;

    this.el.block.textContent = s.block ? s.block.label : 'Transition';
    this.el.next.textContent = `Next: ${s.next.label} · ${SimClock.format(s.next.start)}`;

    this.el.needs.innerHTML = Object.entries(s.avgNeeds)
      .map(
        ([k, v]) => `<div class="flex items-center gap-2">
          <span class="w-14 capitalize text-stone-400">${k === 'hunger' ? 'fed' : k}</span>
          <span class="h-1.5 flex-1 rounded bg-white/10"><span class="block h-full rounded bg-stone-300/70" style="width:${pct(v)}"></span></span>
        </div>`,
      )
      .join('');

    const t = s.today;
    this.el.attendance.innerHTML = `<span class="${STATUS_STYLE.onTime}">${t.onTime} on time</span> ·
      <span class="${STATUS_STYLE.late}">${t.late} late</span> ·
      <span class="${STATUS_STYLE.missed}">${t.missed} missed</span>`;
  }

  _onAttendance({ resident, block, status }) {
    if (status === 'onTime') return; // keep the log for exceptions
    this._log(`${resident.name} ${STATUS_LABEL[status]} · ${block.label}`, STATUS_STYLE[status]);
  }

  _log(text, cls) {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = `${SimClock.format(this.clock.minuteOfDay)}  ${text}`;
    this.el.log.prepend(li);
    while (this.el.log.children.length > 40) this.el.log.lastChild.remove();
  }

  _renderRoster() {
    const rows = [...this.schedule.residents]
      .sort((a, b) => a.composure - b.composure)
      .map((r) => {
        const where = r.path.length ? `→ ${r.placement.zone}` : r.placement.zone;
        return `<tr class="border-t border-white/5">
          <td class="py-0.5 pr-2 text-stone-200">${r.name}</td>
          <td class="pr-2 text-stone-500">${cohortName[r.cohort]}</td>
          <td class="pr-2 text-stone-400 truncate max-w-[9rem]">${where}</td>
          <td class="text-right font-mono" style="color:hsl(${(r.composure / 100) * 120},50%,65%)">${Math.round(r.composure)}</td>
        </tr>`;
      })
      .join('');
    this.el.roster.innerHTML = rows;
  }

  /** Called every frame; cheap text updates only. */
  update(dtReal) {
    this.el.clock.textContent = SimClock.format(this.clock.minuteOfDay);
    this.el.day.textContent = this.clock.day;
    this.el.night.classList.toggle('hidden', !(this.clock.isNight && !this.clock.paused));

    this._rosterTimer -= dtReal;
    if (this._rosterTimer <= 0) {
      this._rosterTimer = 0.5;
      this._renderRoster();
    }
  }
}
