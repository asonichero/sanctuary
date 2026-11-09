import * as THREE from 'three';
import { bus, Events } from '../core/EventBus.js';
import { HALL, STUDIO, COURTYARD, LAWN, HOUSE, RESIDENCE, residenceBeds } from './NavGraph.js';
import { WorldColliders } from './WorldColliders.js';

/**
 * EstateBuilder — owns the renderer, scene, studio lighting, the eye-level
 * camera (driven by player/FirstPersonController), and the blockout of the
 * retreat grounds. While building it records walk collision and floor
 * heights in `this.world` (WorldColliders) and raycast targets in
 * `this.occluders`.
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
  gravel: 0xcabda3,
  gravelLine: 0xb3a587,
  mat: 0x7d8a86,
  timber: 0x8a6a48,
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
    this.world = new WorldColliders();
    this.occluders = []; // static objects that block the interaction ray

    this._initRenderer();
    this._initScene();
    this._initLighting();
    this._initCamera();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
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
    this.scene.fog = new THREE.Fog(PALETTE.sky, 60, 190);
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
  /** Eye-level perspective camera; FirstPersonController owns its pose. */
  _initCamera() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera = new THREE.PerspectiveCamera(70, w / h, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
  }

  // ------------------------------------------------------------------ estate
  /** Build the static blockout of the retreat grounds (world coordinates). */
  build() {
    const estate = new THREE.Group();
    estate.name = 'Estate';

    estate.add(this._ground());
    estate.add(this._paths());

    this._zone(estate, 'Main House', this._atrium());
    this._zone(estate, 'Residence Wing', this._residence());
    this._zone(estate, 'Somatic Studio', this._studio());
    this._zone(estate, 'Alignment Hall', this._hall());
    this._zone(estate, 'Sunken Courtyard', this._courtyard());
    this._zone(estate, 'Assembly Lawn', this._lawn());
    this._zone(estate, 'Gardens', this._gardens());

    estate.add(this._perimeterWall(70));
    estate.add(this._trees(60, 72, 100));

    this.scene.add(estate);
    this.estate = estate;
    bus.emit(Events.ESTATE_BUILT, { zones: [...this.zones.keys()] });
    return this;
  }

  _zone(parent, name, object) {
    object.name = name;
    object.userData.zone = name;
    parent.add(object);
    object.updateMatrixWorld(true);
    this.occluders.push(object);
    this.zones.set(name, { name, object, bounds: new THREE.Box3().setFromObject(object) });
  }

  _shadowed(mesh, cast = true, receive = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  /** Add a box mesh centred at (x, y, z) in group space (world space for zone groups). */
  _box(g, mat, w, h, d, x, y, z, { cast = true, solid = false } = {}) {
    const m = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), cast);
    m.position.set(x, y, z);
    g.add(m);
    if (solid) this.world.addBox(x, z, w, d);
    return m;
  }

  /**
   * Axis-aligned wall from (x0, z0) to (x1, z1) — one of them must match —
   * with doorway `gaps` ([centre, halfWidth] along the wall). Solid.
   */
  _wall(g, mat, x0, z0, x1, z1, { h, t = 0.4, y = 0, gaps = [], cast = true }) {
    const alongX = z0 === z1;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const cuts = gaps.map(([c, hw]) => [c - hw, c + hw]).sort((p, q) => p[0] - q[0]);
    let from = a0;
    const runs = [];
    for (const [g0, g1] of cuts) {
      if (g0 > from) runs.push([from, g0]);
      from = Math.max(from, g1);
    }
    if (a1 > from) runs.push([from, a1]);
    for (const [r0, r1] of runs) {
      const len = r1 - r0;
      const mid = (r0 + r1) / 2;
      if (alongX) this._box(g, mat, len, h, t, mid, y + h / 2, z0, { cast, solid: true });
      else this._box(g, mat, t, h, len, x0, y + h / 2, mid, { cast, solid: true });
    }
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
    strip(3, 13, 28, 10); // studio steps ↔ alignment hall
    strip(3, 15, -30, 11.5); // residence door ↔ garden entry
    g.name = 'Paths';
    return g;
  }

  _building({ w, d, h }) {
    const g = new THREE.Group();
    const body = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(PALETTE.stone)));
    body.position.y = h / 2;
    g.add(body);
    g.add(this._hipRoof(w, d, h));
    return g;
  }

  /** Hipped roof via a 4-sided cone, scaled to the footprint (geometry rotated so the scale stays axis-aligned). */
  _hipRoof(w, d, h) {
    const roofGeo = new THREE.ConeGeometry(Math.SQRT2 / 2, 1, 4, 1).rotateY(Math.PI / 4);
    const roof = this._shadowed(new THREE.Mesh(roofGeo, flat(PALETTE.roof)));
    roof.scale.set(w + 1.2, h * 0.45, d + 1.2); // slight eave overhang
    roof.position.y = h + (h * 0.45) / 2;
    return roof;
  }

  /**
   * Main House: a glass-and-stone atrium. Stone plinth, piers and ring beam;
   * glass walls and a glass roof on stone ribs; a reception desk with the
   * staff posts behind it; planters and benches. Door on the courtyard side.
   */
  _atrium() {
    const H = HOUSE;
    const g = new THREE.Group();
    const stone = flat(PALETTE.stone);
    const trim = flat(PALETTE.trim);
    const glass = new THREE.MeshStandardMaterial({
      color: 0xcfe8ef, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const x0 = H.x - H.w / 2, x1 = H.x + H.w / 2, z0 = H.z - H.d / 2, z1 = H.z + H.d / 2;
    const door = [[H.x, H.doorHalf]];

    // Floor slab.
    this._box(g, flat(0xd9d1c3), H.w, H.floor, H.d, H.x, H.floor / 2, H.z, { cast: false });
    this.world.addFloorBox(H.x, H.z, H.w, H.d, H.floor);

    // Plinth (stone, solid) and glass above it, with the door cut through both.
    const plinth = 0.9;
    for (const [ax, az, bx, bz, gaps] of [[x0, z0, x1, z0, []], [x0, z1, x1, z1, door], [x0, z0, x0, z1, []], [x1, z0, x1, z1, []]]) {
      this._wall(g, stone, ax, az, bx, bz, { h: plinth, t: 0.6, gaps });
      const alongX = az === bz;
      const len = alongX ? bx - ax : bz - az;
      const segs = gaps.length ? [[ax, H.x - H.doorHalf], [H.x + H.doorHalf, bx]] : [[alongX ? ax : az, alongX ? bx : bz]];
      for (const [s0, s1] of segs) {
        const l = s1 - s0, m = (s0 + s1) / 2, gh = H.h - plinth - 0.5;
        const pane = new THREE.Mesh(new THREE.BoxGeometry(alongX ? l : 0.08, gh, alongX ? 0.08 : l), glass);
        pane.position.set(alongX ? m : ax, plinth + gh / 2, alongX ? az : m);
        g.add(pane);
      }
      void len;
    }
    // Stone piers and the door frame.
    const pier = (x, z) => this._box(g, stone, 0.9, H.h, 0.9, x, H.h / 2, z, { solid: true });
    for (const x of [x0, x0 + 7, x1 - 7, x1]) { pier(x, z0); pier(x, z1); }
    pier(H.x, z0);
    pier(x0, H.z); pier(x1, H.z);
    pier(H.x - H.doorHalf - 0.45, z1); pier(H.x + H.doorHalf + 0.45, z1);
    this._box(g, stone, H.doorHalf * 2 + 1.8, 0.8, 1, H.x, 5.2, z1); // door lintel
    // Ring beam, glass roof on ribs.
    this._box(g, trim, H.w + 0.9, 0.5, 0.9, H.x, H.h - 0.25, z0);
    this._box(g, trim, H.w + 0.9, 0.5, 0.9, H.x, H.h - 0.25, z1);
    this._box(g, trim, 0.9, 0.5, H.d, x0, H.h - 0.25, H.z);
    this._box(g, trim, 0.9, 0.5, H.d, x1, H.h - 0.25, H.z);
    for (let x = x0 + 3.5; x < x1; x += 3.5) this._box(g, trim, 0.25, 0.35, H.d, x, H.h + 0.05, H.z);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(H.w, 0.08, H.d), glass);
    roof.position.set(H.x, H.h + 0.25, H.z);
    g.add(roof);

    // Reception desk (staff posts sit behind it), planters and benches.
    this._box(g, flat(PALETTE.timber), 7, 1.1, 1.2, H.x, H.floor + 0.55, H.deskZ, { solid: true });
    this._box(g, stone, 7.4, 0.12, 1.5, H.x, H.floor + 1.16, H.deskZ);
    const planter = (x, z) => {
      const pot = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.75, 1, 8), stone));
      pot.position.set(x, H.floor + 0.5, z);
      const bush = this._shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), flat(PALETTE.foliage)));
      bush.position.set(x, H.floor + 1.7, z);
      g.add(pot, bush);
      this.world.addCircle(x, z, 0.95);
    };
    planter(x0 + 3, z1 - 3); planter(x1 - 3, z1 - 3); planter(x0 + 3, z0 + 3); planter(x1 - 3, z0 + 3);
    for (const x of [-8, 8]) this._box(g, flat(PALETTE.timber), 3.6, 0.5, 0.9, x, H.floor + 0.25, H.z - 3, { solid: true });
    return g;
  }

  /**
   * Residence Wing: stone shell with a hipped roof; inside, a central hallway
   * with four rooms either side, three beds per room.
   */
  _residence() {
    const R = RESIDENCE;
    const g = new THREE.Group();
    const stone = flat(PALETTE.stone);
    const plaster = flat(0xe9e2d4);
    const x0 = R.x - R.w / 2, x1 = R.x + R.w / 2, z0 = R.z - R.d / 2, z1 = R.z + R.d / 2;

    this._box(g, flat(0xb59a7c), R.w, R.floor, R.d, R.x, R.floor / 2, R.z, { cast: false });
    this.world.addFloorBox(R.x, R.z, R.w, R.d, R.floor);
    // Outer shell (door in the south wall, on the path).
    this._wall(g, stone, x0, z0, x1, z0, { h: R.h });
    this._wall(g, stone, x0, z1, x1, z1, { h: R.h, gaps: [[R.x, R.doorHalf]] });
    this._wall(g, stone, x0, z0, x0, z1, { h: R.h });
    this._wall(g, stone, x1, z0, x1, z1, { h: R.h });
    this._box(g, flat(PALETTE.trim), R.doorHalf * 2 + 0.8, 0.6, 0.6, R.x, 3.3, z1); // lintel
    this._box(g, stone, R.doorHalf * 2, R.h - 3.0, 0.4, R.x, 3.0 + (R.h - 3.0) / 2, z1); // wall above the door
    // Ceiling and roof.
    this._box(g, plaster, R.w, 0.3, R.d, R.x, R.h - 0.15, R.z);
    const roof = this._hipRoof(R.w, R.d, R.h);
    roof.position.x = R.x;
    roof.position.z = R.z;
    g.add(roof);

    // Hallway walls with a door into each room; partitions between rooms.
    const wallH = 3.4;
    const roomEnd = R.rooms[R.rooms.length - 1] + R.roomDepth / 2;
    const doors = R.rooms.map((c) => [c, 0.7]);
    for (const side of [-1, 1]) {
      const hx = R.x + side * R.hallHalf;
      const ox = side < 0 ? x0 : x1;
      this._wall(g, plaster, hx, z0, hx, roomEnd, { h: wallH, t: 0.2, gaps: doors });
      for (const c of [...R.rooms.slice(1).map((c) => c - R.roomDepth / 2), roomEnd]) {
        this._wall(g, plaster, Math.min(ox, hx), c, Math.max(ox, hx), c, { h: wallH, t: 0.2 });
      }
    }
    // Beds: frame, mattress and pillow, at the outer wall.
    const frame = flat(PALETTE.timber);
    const linen = [flat(0xd8dde2), flat(0xc9d3c4), flat(0xe0d2c0)];
    residenceBeds().forEach((b, i) => {
      this._box(g, frame, 2.0, 0.35, 1.0, b.x, R.floor + 0.175, b.z, { solid: true });
      this._box(g, linen[i % 3], 1.9, 0.18, 0.92, b.x, R.floor + 0.44, b.z);
      this._box(g, flat(0xf4f1ea), 0.35, 0.1, 0.7, b.x + b.side * 0.72, R.floor + 0.58, b.z);
    });
    // Warm hallway lights (no shadows).
    for (const z of [-15, -6, 2]) {
      const lamp = new THREE.PointLight(0xffd6a0, 18, 14, 1.6);
      lamp.position.set(R.x, R.h - 1, z);
      g.add(lamp);
    }
    return g;
  }

  /** Somatic Studio: open domed pavilion with a 5×5 grid of mats (centre left clear for staff). */
  _studio() {
    const g = new THREE.Group();
    g.position.set(STUDIO.x, 0, STUDIO.z);
    const base = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.8, 8), flat(PALETTE.stone)));
    base.position.y = 0.4;
    g.add(base);
    this.world.addFloorCircle(STUDIO.x, STUDIO.z, 9.2, STUDIO.floor);
    const colMat = flat(PALETTE.stone);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2; // leave an entrance gap facing +Z
      const col = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 6), colMat));
      col.position.set(Math.cos(a) * 7.8, 3.3, Math.sin(a) * 7.8);
      g.add(col);
      this.world.addCircle(STUDIO.x + Math.cos(a) * 7.8, STUDIO.z + Math.sin(a) * 7.8, 0.4);
    }
    const dome = this._shadowed(new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.5, 8), flat(PALETTE.roof)));
    dome.position.y = 7.5;
    g.add(dome);
    const mats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.05, 2.0), flat(PALETTE.mat), 24);
    mats.receiveShadow = true;
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        if (r === 0 && c === 0) continue;
        mats.setMatrixAt(i++, m.makeTranslation(c * STUDIO.spacing, STUDIO.floor + 0.03, r * STUDIO.spacing));
      }
    }
    g.add(mats);
    return g;
  }

  /** Alignment Hall: low platform, timber posts and a gabled roof; open on all sides. */
  _hall() {
    const g = new THREE.Group();
    g.position.set(HALL.x, 0, HALL.z);
    const w = 18, d = 14, h = 5;
    const floor = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, HALL.floor, d), flat(PALETTE.stone)), false);
    floor.position.y = HALL.floor / 2;
    g.add(floor);
    this.world.addFloorBox(HALL.x, HALL.z, w, d, HALL.floor);
    const postMat = flat(PALETTE.timber);
    for (const x of [-w / 2 + 0.4, 0, w / 2 - 0.4]) {
      for (const z of [-d / 2 + 0.4, d / 2 - 0.4]) {
        const post = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), postMat));
        post.position.set(x, HALL.floor + h / 2, z);
        g.add(post);
        this.world.addBox(HALL.x + x, HALL.z + z, 0.4, 0.4);
      }
    }
    // Gabled roof: a triangular prism along X.
    const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2); // apex up, ridge along X
    const roof = this._shadowed(new THREE.Mesh(roofGeo, flat(PALETTE.roof)));
    roof.scale.set(w + 1, 2.4, (d + 1.5) / Math.sqrt(3));
    roof.position.y = HALL.floor + h + 1.2;
    g.add(roof);
    // Painted lineup marks.
    const markMat = new THREE.MeshBasicMaterial({ color: 0xf4efe6 });
    for (const z of [21.5, 24, 26.5, 29]) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(14, 0.02, 0.08), markMat);
      mark.position.set(0, HALL.floor + 0.01, z - HALL.z + 0.45);
      g.add(mark);
    }
    return g;
  }

  /** Sunken Courtyard: raked gravel bowl round the fountain, ringed by a low stone step. */
  _courtyard() {
    const g = new THREE.Group();
    g.position.set(COURTYARD.x, 0, COURTYARD.z);
    const R = COURTYARD.radius;
    const gravel = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.2, 24), flat(PALETTE.gravel)), false);
    gravel.position.y = 0.1;
    g.add(gravel);
    this.world.addFloorCircle(COURTYARD.x, COURTYARD.z, R, 0.2);
    this.world.addFloorRing(COURTYARD.x, COURTYARD.z, R + 0.3, R + 1.3, 0.35);
    const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.gravelLine });
    for (const r of [4.2, 5.8, 7.0, 8.2, 9.4]) {
      const line = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r + 0.06, 40).rotateX(-Math.PI / 2), lineMat);
      line.position.y = 0.205;
      g.add(line);
    }
    // Step ring with openings where the four paths come in.
    const stepMat = flat(PALETTE.stone);
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * Math.PI * 2;
      const nearPath = [0, 0.5, 1, 1.5].some((k) => Math.abs(Math.atan2(Math.sin(a - k * Math.PI), Math.cos(a - k * Math.PI))) < 0.2);
      if (nearPath) continue;
      const len = 2 * (R + 0.8) * Math.sin(Math.PI / segs);
      const step = this._shadowed(new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.35, 1.0), stepMat));
      step.position.set(Math.cos(a) * (R + 0.8), 0.175, Math.sin(a) * (R + 0.8));
      step.rotation.y = -a + Math.PI / 2;
      g.add(step);
    }
    const basin = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 1, 8), flat(PALETTE.stone)));
    basin.position.y = 0.6;
    g.add(basin);
    this.world.addCircle(COURTYARD.x, COURTYARD.z, 3.4);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 8), flat(PALETTE.water, { roughness: 0.2 }));
    water.position.y = 1.05;
    g.add(water);
    const spout = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.4, 6), flat(PALETTE.stone)));
    spout.position.y = 2;
    g.add(spout);
    return g;
  }

  /** Assembly Lawn: a low dais on the avenue south of the courtyard; residents line up facing it. */
  _lawn() {
    const g = new THREE.Group();
    const stone = flat(PALETTE.stone);
    this._box(g, stone, 10, LAWN.dais, 3, LAWN.x, LAWN.dais / 2, LAWN.daisZ);
    this.world.addFloorBox(LAWN.x, LAWN.daisZ, 10, 3, LAWN.dais);
    this._box(g, stone, 4, LAWN.dais / 2, 0.8, LAWN.x, LAWN.dais / 4, LAWN.daisZ - 1.9);
    this.world.addFloorBox(LAWN.x, LAWN.daisZ - 1.9, 4, 0.8, LAWN.dais / 2);
    this._box(g, flat(PALETTE.trim), 6, 2.2, 0.15, LAWN.x, LAWN.dais + 1.6, LAWN.daisZ + 1.3, { solid: true });
    for (const x of [-3.2, 3.2]) {
      const pole = this._shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 5), flat(PALETTE.timber)));
      pole.position.set(LAWN.x + x, LAWN.dais + 1.7, LAWN.daisZ + 1.3);
      g.add(pole);
    }
    return g;
  }

  _gardens() {
    const g = new THREE.Group();
    const hedgeMat = flat(PALETTE.foliageDark);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        this._box(g, hedgeMat, 5, 1.2, 5, -30 + (col - 1) * 7, 0.6, 30 + (row - 1) * 7, { solid: true });
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
    this.occluders.push(g);
    // The player stays inside the wall (WorldColliders boundary, r = 69).
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

  update() {}

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((mt) => mt.dispose());
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
