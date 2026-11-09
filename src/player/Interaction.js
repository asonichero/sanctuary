import * as THREE from 'three';
import { bus, Events } from '../core/EventBus.js';
import { INTERACT_RANGE, RADIAL } from '../content/interactions.js';
import { BANDS } from '../content/composure.js';
import { ROLES } from '../content/roster.js';
import { blockedReason } from '../sim/interactionRules.js';

const CENTER = new THREE.Vector2(0, 0);

/**
 * Interaction — what the crosshair is on, and what the mouse does about it.
 *
 * Each frame a ray from the centre of the camera (INTERACT_RANGE long) is
 * tested against visible agents and the estate's static geometry; the first
 * thing hit wins, so you can't target someone through a wall or a column.
 *
 * With the mouse captured:
 *   - Left-click  on an agent → patrol check (INTERACT 'check').
 *   - Right-click on a resident → hold to open the radial menu; move the mouse
 *     toward an option and release to choose it (release in the middle
 *     cancels). Right-click on staff → inspect.
 * The first click on the canvas only captures the mouse.
 */
export class Interaction {
  constructor({ camera, scene, dom, agents, occluders, controller, schedule, radial }) {
    this.camera = camera;
    this.dom = dom;
    this.agents = agents;
    this.occluders = occluders;
    this.controller = controller;
    this.schedule = schedule;
    this.radial = radial;
    this.byMesh = new Map(agents.map((a) => [a.mesh, a]));
    this.target = null;
    this.menuAgent = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = INTERACT_RANGE;
    this._time = 0;

    // Floating marker over the targeted agent.
    const geo = new THREE.ConeGeometry(0.18, 0.32, 4).rotateX(Math.PI);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
    this.marker = new THREE.Mesh(geo, this.markerMat);
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    scene.add(this.marker);

    this._bind();
  }

  _bind() {
    this._onMouseDown = (e) => {
      if (!this.controller.locked) {
        if (e.button === 0) this.controller.requestLock();
        return;
      }
      if (e.button === 0) {
        if (this.menuAgent) return this._closeMenu(true); // click also confirms in the menu
        if (this.target) this._emit('check', this.target);
      } else if (e.button === 2 && this.target) {
        if (this.target.sim.role === ROLES.RESIDENT) this._openMenu(this.target);
        else this._emit('inspect', this.target);
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 2 && this.menuAgent) this._closeMenu(true);
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._offLock = bus.on(Events.POINTER_LOCK, ({ locked }) => {
      if (!locked && this.menuAgent) this._closeMenu(false);
    });
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
  }

  _emit(action, agent) {
    // The agent turns to face you for a moment.
    const p = this.controller.position;
    agent.attention = { x: p.x, z: p.z, until: this._time + 2.5 };
    bus.emit(Events.INTERACT, { action, agent });
  }

  // ------------------------------------------------------------- radial menu
  /** Options for the radial, with the reason each is unavailable (if any). */
  menuOptions(agent) {
    const ctx = this.schedule.interactionContext(agent);
    return RADIAL.map((id) => ({ id, blocked: blockedReason(agent, id, ctx) }));
  }

  _openMenu(agent) {
    this.menuAgent = agent;
    this.controller.lookFrozen = true;
    this.controller.onFrozenMove = (dx, dy) => this.radial.move(dx, dy);
    this.radial.open(agent, this.menuOptions(agent));
    bus.emit(Events.RADIAL_OPEN, { agent });
  }

  _closeMenu(commit) {
    const agent = this.menuAgent;
    const choice = this.radial.close();
    this.menuAgent = null;
    this.controller.lookFrozen = false;
    this.controller.onFrozenMove = null;
    const picked = commit && choice && !choice.blocked ? choice.id : null;
    bus.emit(Events.RADIAL_CLOSE, { agent, choice: picked });
    if (picked) this._emit(picked, agent);
    else if (commit && choice?.blocked) bus.emit(Events.INTERACT_RESULT, { action: choice.id, agent, ok: false, message: choice.blocked });
  }

  // ---------------------------------------------------------------- per frame
  /** Agent under the crosshair within range, or null. */
  pick() {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const meshes = this.agents.filter((a) => a.mesh.visible).map((a) => a.mesh);
    const hits = this.raycaster.intersectObjects([...meshes, ...this.occluders], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !this.byMesh.has(o)) o = o.parent;
      return o ? this.byMesh.get(o) : null; // first hit decides: a wall in front blocks
    }
    return null;
  }

  update(dtReal) {
    this._time += dtReal;
    if (this.menuAgent) {
      this.radial.refresh(this.menuOptions(this.menuAgent));
    } else {
      const t = this.pick();
      if (t !== this.target) {
        this.target = t;
        bus.emit(Events.TARGET_CHANGED, { agent: t });
      }
    }
    const shown = this.menuAgent ?? this.target;
    this.marker.visible = !!shown;
    if (shown) {
      const head = shown.mesh.position;
      this.marker.position.set(head.x, head.y + 3.15 + Math.sin(this._time * 4) * 0.06, head.z);
      this.marker.rotation.y += dtReal * 2;
      this.markerMat.color.set(shown.sim.role === ROLES.RESIDENT ? BANDS[shown.band].color : 0xd9dde1);
    }
  }

  /** Seconds of real time elapsed (for attention timers shared with syncMesh). */
  get time() {
    return this._time;
  }

  dispose() {
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
    this._offLock();
  }
}
