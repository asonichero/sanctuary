import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bus, Events } from '../core/EventBus.js';

/**
 * EstateBuilder — owns the renderer, scene, studio lighting, the
 * management-sim camera rig, and the blockout of the retreat grounds.
 *
 * Visual language: flat-shaded low-poly, warm key light, soft cool fill,
 * a rim light for silhouette separation, and gentle distance fog.
 */

export const PALETTE = Object.freeze({
  sky: 0xd9d2c5,
  ground: 0x9fae84,
  path: 0xd8c9a8,
  stone: 0xe7e1d6,
  roof: 0x7b5a4a,
  trim: 0x5d6b62,
  water: 0x7fb3b8,
  foliage: 0x6f8f5c,
  foliageDark: 0x557447,
  trunk: 0x6b4e3a,
});

const TOD = {
  skyDay: new THREE.Color(PALETTE.sky),
  skyDusk: new THREE.Color(0xe7b48f),
  skyNight: new THREE.Color(0x1d2430),
  keyNoon: new THREE.Color(0xffe2c0),
  keyLow: new THREE.Color(0xff9e63),
};

const flat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });

export class EstateBuilder {
  /**
   * @param {HTMLElement} container element the canvas is mounted into
   */
  constructor(container) {
    this.container = container;
    this.zones = new Map(); // name -> { name, mesh, bounds }
    this._keys = new Set();
    this._tmpVec = new THREE.Vector3();

    this._initRenderer();
    this._initScene();
    this._initLighting();
    this._initCamera();
    this._bindInput();
  }

  // ---------------------------------------------------------------- renderer
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(this.container.clientWidth, this.container.clientHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.container.appendChild(r.domElement);
    this.renderer = r;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.sky, 90, 220);
  }

  // ---------------------------------------------------------------- lighting
  _initLighting() {
    const lights = new THREE.Group();
    lights.name = 'StudioLighting';

    // Ambient bounce: warm ground, cool sky.
    const hemi = new THREE.HemisphereLight(0xf2efe8, 0x8a7a63, 0.9);
    lights.add(hemi);

    // Key: warm, low-ish sun, casts the only shadows.
    const key = new THREE.DirectionalLight(0xffe2c0, 2.4);
    key.position.set(45, 70, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    const s = key.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 10; s.far = 200;
    lights.add(key, key.target);

    // Fill: cool, opposite side, no shadows.
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    fill.position.set(-50, 30, -20);
    lights.add(fill);

    // Rim: from behind to separate silhouettes from the ground.
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-10, 40, -70);
    lights.add(rim);

    this.lights = { hemi, key, fill, rim };
    this.scene.add(lights);
  }

  /**
   * Drive the studio rig from the simulation clock. `hours` is 0–24.
   * Sun rises ~06:00, sets ~20:00; at night a dim cool fill stands in for moonlight.
   */
  setTimeOfDay(hours) {
    const { hemi, key, fill, rim } = this.lights;
    const t = (hours - 6) / 14; // 0 at sunrise, 1 at sunset
    const sunHeight = Math.sin(Math.PI * THREE.MathUtils.clamp(t, -0.15, 1.15));
    const daylight = THREE.MathUtils.smoothstep(sunHeight, -0.1, 0.35);
    const lowSun = 1 - THREE.MathUtils.smoothstep(sunHeight, 0.05, 0.45); // warm tint near horizon

    const az = Math.PI * THREE.MathUtils.clamp(t, 0, 1);
    key.position.set(Math.cos(az) * 70, 15 + Math.max(sunHeight, 0) * 65, 30);
    key.intensity = 2.4 * daylight;
    key.color.copy(TOD.keyNoon).lerp(TOD.keyLow, lowSun);

    hemi.intensity = 0.22 + 0.68 * daylight;
    fill.intensity = 0.35 + 0.25 * daylight;
    rim.intensity = 0.25 + 0.55 * daylight;

    this.scene.background.copy(TOD.skyNight).lerp(TOD.skyDay, daylight).lerp(TOD.skyDusk, lowSun * daylight * 0.6);
    this.scene.fog.color.copy(this.scene.background);
  }

  // ------------------------------------------------------------------ camera
  _initCamera() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 500);
    this.homeTarget = new THREE.Vector3(0, 0, 0);
    this.homePosition = new THREE.Vector3(55, 60, 75);
    this.camera.position.copy(this.homePosition);

    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.target.copy(this.homeTarget);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.screenSpacePanning = false; // pan along the ground plane
    c.minDistance = 15;
    c.maxDistance = 160;
    c.minPolarAngle = THREE.MathUtils.degToRad(20);
    c.maxPolarAngle = THREE.MathUtils.degToRad(78); // never dip below the horizon
    c.zoomToCursor = true;
    c.addEventListener('change', () =>
      bus.emit(Events.CAMERA_MOVED, { target: c.target, position: this.camera.position }),
    );
    this.controls = c;

    // Keep the focus point inside the estate.
    this.panBounds = new THREE.Box3(new THREE.Vector3(-80, 0, -80), new THREE.Vector3(80, 0, 80));
  }

  resetCamera() {
    this.controls.target.copy(this.homeTarget);
    this.camera.position.copy(this.homePosition);
    this.controls.update();
    bus.emit(Events.CAMERA_RESET);
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === 'f') this.resetCamera();
      else this._keys.add(k);
    };
    this._onKeyUp = (e) => this._keys.delete(e.key.toLowerCase());
    this._onBlur = () => this._keys.clear();
    this._onResize = () => this.resize();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
  }

  /** WASD pans along the ground relative to view; Q/E orbit around target. */
  _updateKeyboardCamera(dt) {
    if (this._keys.size === 0) return;
    const c = this.controls;
    const distance = this.camera.position.distanceTo(c.target);
    const speed = distance * 0.9 * dt;

    const forward = this._tmpVec.subVectors(c.target, this.camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (this._keys.has('w')) move.add(forward);
    if (this._keys.has('s')) move.sub(forward);
    if (this._keys.has('d')) move.add(right);
    if (this._keys.has('a')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      c.target.add(move);
      this.camera.position.add(move);
    }

    const rot = (this._keys.has('q') ? 1 : 0) - (this._keys.has('e') ? 1 : 0);
    if (rot !== 0) {
      const offset = this.camera.position.clone().sub(c.target);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 1.6 * dt);
      this.camera.position.copy(c.target).add(offset);
    }
  }

  _clampTarget() {
    const c = this.controls;
    const before = c.target.clone();
    c.target.clamp(this.panBounds.min, this.panBounds.max);
    if (!before.equals(c.target)) this.camera.position.add(c.target.clone().sub(before));
  }

  // ------------------------------------------------------------------ estate
  /** Build the static blockout of the retreat grounds. */
  build() {
    const estate = new THREE.Group();
    estate.name = 'Estate';

    estate.add(this._ground());
    estate.add(this._paths());

    this._zone(estate, 'Main House', this._building({ w: 28, d: 16, h: 10, floors: 2 }), [0, 0, -22]);
    this._zone(estate, 'Residence Wing', this._building({ w: 12, d: 24, h: 7 }), [-30, 0, -8]);
    this._zone(estate, 'Wellness Pavilion', this._pavilion(), [28, 0, -6]);
    this._zone(estate, 'Dining Hall', this._building({ w: 16, d: 12, h: 6 }), [28, 0, 24]);
    this._zone(estate, 'Courtyard', this._courtyard(), [0, 0, 8]);
    this._zone(estate, 'Gardens', this._gardens(), [-30, 0, 30]);

    estate.add(this._perimeterWall(70));
    estate.add(this._trees(60, 72, 100));

    this.scene.add(estate);
    this.estate = estate;
    bus.emit(Events.ESTATE_BUILT, { zones: [...this.zones.keys()] });
    return this;
  }

  _zone(parent, name, object, [x, y, z]) {
    object.name = name;
    object.position.set(x, y, z);
    object.userData.zone = name;
    parent.add(object);
    object.updateMatrixWorld(true);
    this.zones.set(name, { name, object, bounds: new THREE.Box3().setFromObject(object) });
  }

  _shadowed(mesh, cast = true, receive = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  _ground() {
    const geo = new THREE.CircleGeometry(160, 48);
    geo.rotateX(-Math.PI / 2);
    // Gentle low-poly undulation outside the walled estate.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 75) pos.setY(i, Math.sin(x * 0.08) * Math.cos(z * 0.07) * 2.5 * Math.min(1, (r - 75) / 30));
    }
    geo.computeVertexNormals();
    const ground = this._shadowed(new THREE.Mesh(geo, flat(PALETTE.ground)), false, true);
    ground.name = 'Ground';
    return ground;
  }

  _paths() {
    const g = new THREE.Group();
    const mat = flat(PALETTE.path);
    const strip = (w, d, x, z) => {
      const m = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat), false, true);
      m.position.set(x, 0.05, z);
      g.add(m);
    };
    strip(4, 70, 0, 18); // main avenue from gate to house
    strip(60, 3, 0, 8); // east–west cross path
    strip(3, 15, 28, 10.5); // pavilion steps ↔ dining hall
    strip(3, 15, -30, 11.5); // residence door ↔ garden entry
    g.name = 'Paths';
    return g;
  }

  _building({ w, d, h, floors = 1 }) {
    const g = new THREE.Group();
    const body = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(PALETTE.stone)));
    body.position.y = h / 2;
    g.add(body);

    // Hipped roof via a 4-sided cone, scaled to the footprint.
    // Rotate the geometry (not the mesh) so the non-uniform scale stays axis-aligned.
    const roofGeo = new THREE.ConeGeometry(Math.SQRT2 / 2, 1, 4, 1).rotateY(Math.PI / 4);
    const roof = this._shadowed(new THREE.Mesh(roofGeo, flat(PALETTE.roof)));
    roof.scale.set(w + 1.2, h * 0.45, d + 1.2); // slight eave overhang
    roof.position.y = h + (h * 0.45) / 2;
    g.add(roof);

    // Floor trim bands.
    for (let f = 1; f <= floors; f++) {
      const band = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3), flat(PALETTE.trim)), false);
      band.position.y = (h / floors) * f - 0.15;
      g.add(band);
    }
    return g;
  }

  _pavilion() {
    const g = new THREE.Group();
    const base = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.8, 8), flat(PALETTE.stone)));
    base.position.y = 0.4;
    g.add(base);
    const colMat = flat(PALETTE.stone);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2; // leave an entrance gap facing +Z
      const col = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 6), colMat));
      col.position.set(Math.cos(a) * 7.8, 3.3, Math.sin(a) * 7.8);
      g.add(col);
    }
    const dome = this._shadowed(new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.5, 8), flat(PALETTE.roof)));
    dome.position.y = 7.5;
    g.add(dome);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.1, 8), flat(PALETTE.water, { roughness: 0.2 }));
    pool.position.y = 0.85;
    pool.receiveShadow = true;
    g.add(pool);
    return g;
  }

  _courtyard() {
    const g = new THREE.Group();
    const plaza = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.2, 12), flat(PALETTE.path)), false);
    plaza.position.y = 0.1;
    g.add(plaza);
    const basin = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 1, 8), flat(PALETTE.stone)));
    basin.position.y = 0.6;
    g.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 8), flat(PALETTE.water, { roughness: 0.2 }));
    water.position.y = 1.05;
    g.add(water);
    const spout = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.4, 6), flat(PALETTE.stone)));
    spout.position.y = 2;
    g.add(spout);
    return g;
  }

  _gardens() {
    const g = new THREE.Group();
    const hedgeMat = flat(PALETTE.foliageDark);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const bed = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 5), hedgeMat));
        bed.position.set((col - 1) * 7, 0.6, (row - 1) * 7);
        g.add(bed);
      }
    }
    return g;
  }

  _perimeterWall(radius) {
    const g = new THREE.Group();
    g.name = 'PerimeterWall';
    const mat = flat(PALETTE.stone);
    const segments = 28;
    const gateAngle = Math.PI / 2; // +Z, aligned with the avenue
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      if (Math.abs(Math.atan2(Math.sin(mid - gateAngle), Math.cos(mid - gateAngle))) < 0.12) continue; // gate gap
      const len = 2 * radius * Math.sin((a1 - a0) / 2);
      const seg = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 2.2, 0.8), mat));
      seg.position.set(Math.cos(mid) * radius, 1.1, Math.sin(mid) * radius);
      seg.rotation.y = -mid + Math.PI / 2;
      g.add(seg);
    }
    return g;
  }

  /** Scattered low-poly trees in a ring, using instancing for cheap draws. */
  _trees(count, innerR, outerR) {
    const g = new THREE.Group();
    g.name = 'Trees';
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 2, 5).translate(0, 1, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.8, 0).translate(0, 3.4, 0);
    const trunks = this._shadowed(new THREE.InstancedMesh(trunkGeo, flat(PALETTE.trunk), count));
    const crowns = this._shadowed(new THREE.InstancedMesh(crownGeo, flat(PALETTE.foliage), count));

    // Deterministic pseudo-random so the estate looks the same each load.
    let seed = 1337;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sVec = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.15) { i--; continue; } // keep gate clear
      const r = innerR + rand() * (outerR - innerR);
      const s = 0.8 + rand() * 0.9;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI);
      m.compose(p, q, sVec.set(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    }
    g.add(trunks, crowns);
    return g;
  }

  // -------------------------------------------------------------- lifecycle
  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    bus.emit(Events.RESIZE, { width: w, height: h });
  }

  update(dt) {
    this._updateKeyboardCamera(dt);
    this.controls.update();
    this._clampTarget();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((mt) => mt.dispose());
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
