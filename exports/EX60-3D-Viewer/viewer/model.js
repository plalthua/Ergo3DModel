// Builds the parametric EX60 driver-workplace scene from data/ex60_spec.json.
// All geometry lives in `root`, expressed in the vehicle frame (mm, Z up);
// root converts to three.js world (metres, Y up).
import * as THREE from 'three';
import * as K from './kinematics.js';

const val = (d) => (typeof d === 'object' ? d.value : d);
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

const MAT = {
  tyre: new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.9 }),
  rimMetal: new THREE.MeshStandardMaterial({ color: 0x8d949c, metalness: 0.7, roughness: 0.35 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8 }),
  dash: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.75, side: THREE.DoubleSide }),
  floor: new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 1 }),
  seat: new THREE.MeshStandardMaterial({ color: 0xc9b79c, roughness: 0.85 }),
  seatRail: new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.6, roughness: 0.4 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe8ff, metalness: 1.0, roughness: 0.05, side: THREE.DoubleSide }),
  housing: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5 }),
  frontLight: new THREE.MeshStandardMaterial({ color: 0xe7f5ff, emissive: 0xc4e8ff, emissiveIntensity: 0.8 }),
  rearLight: new THREE.MeshStandardMaterial({ color: 0xcd2430, emissive: 0xbd1020, emissiveIntensity: 0.7 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe0a97e, roughness: 0.7 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0x3d6fa8, roughness: 0.8 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff3366 }),
  eyellipse: new THREE.MeshBasicMaterial({ color: 0x00e0ff, wireframe: true, transparent: true, opacity: 0.35 }),
};

function box(w, d, h, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
}

// Shape-preserving Hermite interpolation avoids overshoot at body-section extrema.
function smoothValue(rows, x, column) {
  const last = rows.length - 1;
  if (x <= rows[0][0]) return rows[0][column];
  if (x >= rows[last][0]) return rows[last][column];
  const slope = (i) => (rows[i + 1][column] - rows[i][column]) / (rows[i + 1][0] - rows[i][0]);
  const tangent = (i) => {
    if (i === 0) return slope(0);
    if (i === last) return slope(last - 1);
    const a = slope(i - 1), b = slope(i);
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  };
  const i = rows.findIndex((r, j) => j < last && x < rows[j + 1][0]);
  const a = rows[i], b = rows[i + 1], h = b[0] - a[0], t = (x - a[0]) / h;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a[column] +
    (t ** 3 - 2 * t ** 2 + t) * h * tangent(i) +
    (-2 * t ** 3 + 3 * t ** 2) * b[column] + (t ** 3 - t ** 2) * h * tangent(i + 1);
}

// Shared vertices keep normals continuous across longitudinal panel samples.
function gridSurface(xs, rows, point, material, groupForInterval) {
  const positions = [], indices = [];
  for (const x of xs) {
    for (let j = 0; j <= rows; j++) positions.push(...point(x, j / rows));
  }
  const geometry = new THREE.BufferGeometry();
  for (let i = 0; i < xs.length - 1; i++) {
    const start = indices.length;
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
    if (groupForInterval) geometry.addGroup(start, indices.length - start, groupForInterval(xs[i], xs[i + 1]));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// Original procedural studio illumination, not a photographic texture.
export function studioEnvironment(renderer, spec) {
  const d = val(spec.visual_reconstruction.exterior_refinement).studio;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = d.size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is required for studio reflections.');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  for (const [stop, color] of d.gradient) gradient.addColorStop(stop, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const panel of d.softboxes) {
    context.fillStyle = panel.color;
    context.fillRect(...panel.rect);
  }
  const source = new THREE.CanvasTexture(canvas);
  source.colorSpace = THREE.SRGBColorSpace;
  source.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = val(d.exposure);
  return target.texture;
}

function roundedShape(points, radius) {
  const shape = new THREE.Shape();
  const corners = points.map((point, i) => {
    const p = new THREE.Vector2(...point);
    const before = new THREE.Vector2(...points[(i + points.length - 1) % points.length]).sub(p);
    const after = new THREE.Vector2(...points[(i + 1) % points.length]).sub(p);
    const r = Math.min(radius, before.length() / 2, after.length() / 2);
    return [p.clone().add(before.normalize().multiplyScalar(r)), p, p.clone().add(after.normalize().multiplyScalar(r))];
  });
  shape.moveTo(...corners[0][0].toArray());
  for (const [before, point, after] of corners) {
    shape.lineTo(...before.toArray());
    shape.quadraticCurveTo(point.x, point.y, after.x, after.y);
  }
  shape.closePath();
  return shape;
}

function roundedBox(size, radius, material) {
  const [w, h, depth] = size;
  const shape = roundedShape([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], radius);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geometry.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geometry, material);
}

function profilePrism(points, width, radius, material) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(points, radius), { depth: width, bevelEnabled: false, curveSegments: 10 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, width / 2, 0);
  return new THREE.Mesh(geometry, material);
}

// Rounded contour loft: shared by upholstery and mirror shells, built only once.
function contourSolid(points, rings, radius, material) {
  const contour = roundedShape(points, radius).getPoints(10);
  if (contour[0].distanceTo(contour[contour.length - 1]) < 1e-6) contour.pop();
  const positions = [], indices = [], n = contour.length;
  for (const [z, sx, sy, dx, dy] of rings) {
    for (const p of contour) positions.push(p.x * sx + dx, p.y * sy + dy, z);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i, b = r * n + (i + 1) % n, c = b + n, d = a + n;
      indices.push(a, b, d, b, c, d);
    }
  }
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const end = (rings.length - 1) * n;
  for (const [a, b, c] of faces) indices.push(c, b, a, end + a, end + b, end + c);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// Original schematic graphics, not image crops or a reproduction of vehicle software.
function displayTexture(key, size) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = size;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas 2D context is required for dashboard display graphics.');
  c.scale(canvas.width / 1024, canvas.height / 640);
  c.fillStyle = '#0b1118';
  c.fillRect(0, 0, 1024, 640);
  const left = key === 'driver' ? 270 : 380;
  c.fillStyle = '#162c3c';
  c.fillRect(left, 50, 1024 - left - 12, 510);
  c.strokeStyle = '#355367';
  c.lineWidth = 5;
  for (let i = 0; i < 10; i++) {
    c.beginPath();
    c.moveTo(left + i * 95, 55);
    c.lineTo(left + i * 75 - 110, 300);
    c.lineTo(left + i * 105 - 50, 555);
    c.stroke();
  }
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    c.moveTo(left, 75 + i * 82);
    c.bezierCurveTo(580, 30 + i * 90, 730, 200 + i * 65, 1010, 95 + i * 85);
    c.stroke();
  }
  c.strokeStyle = '#79b8df';
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(760, 550);
  c.lineTo(710, 400);
  c.lineTo(790, 290);
  c.lineTo(870, 170);
  c.stroke();
  c.fillStyle = '#eef4f7';
  c.font = '22px sans-serif';
  c.fillText('09:41     22 C', 28, 33);
  c.fillText('DEMO', 915, 33);
  if (key === 'driver') {
    c.font = '140px sans-serif';
    c.fillText('0', 65, 350);
    c.font = '30px sans-serif';
    c.fillText('km/h', 62, 407);
    c.fillText('P', 930, 220);
    c.fillText('READY', 35, 560);
  } else {
    c.fillStyle = '#1e2932';
    c.fillRect(22, 65, 330, 490);
    c.fillStyle = '#89a8bd';
    c.fillRect(65, 95, 240, 180);
    c.fillStyle = '#304e68';
    c.beginPath();
    c.arc(185, 185, 65, 0, 2 * Math.PI);
    c.fill();
    c.fillStyle = '#edf2f7';
    c.font = '27px sans-serif';
    c.fillText('Media', 55, 330);
    c.font = '23px sans-serif';
    c.fillText('Illustrative display', 55, 373);
    c.fillText('|<       ||       >|', 65, 470);
    c.fillStyle = '#253942';
    c.fillRect(430, 80, 320, 95);
    c.fillStyle = '#e9eef2';
    c.fillText('Search destination', 455, 135);
  }
  c.fillStyle = '#10181e';
  c.fillRect(0, 570, 1024, 70);
  c.fillStyle = '#e9eef2';
  c.font = '26px sans-serif';
  c.fillText('22 C     -   +', 35, 615);
  c.fillText('AUTO', 465, 615);
  c.fillText('-   +     22 C', 800, 615);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Orient object so its local axes become (X, Y, Z) given as vehicle-frame arrays. */
function setBasis(obj, X, Y, Z) {
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(X), V(Y), V(Z)));
}

function basisFromNormal(n, upHint = [0, 0, 1]) {
  const Y = K.unit(K.sub(upHint, K.scale(n, K.dot(upHint, n))));
  return [K.cross(Y, n), Y, n];
}

/** Capsule-like limb between two vehicle-frame points. */
class Limb {
  constructor(radius, mat, parent) {
    this.radius = radius;
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), mat);
    this.j = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    parent.add(this.mesh, this.j);
  }
  set(a, b, radius = this.radius) {
    const d = K.sub(b, a), len = K.norm(d);
    this.mesh.position.copy(V(K.scale(K.add(a, b), 0.5)));
    this.mesh.scale.set(radius, Math.max(len, 1e-3), radius);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(K.unit(d)));
    this.j.position.copy(V(b));
    this.j.scale.setScalar(radius);
  }
}

export class Ex60Scene {
  constructor(spec) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = 'EX60_ergo_vehicle_frame';
    this.root.rotation.x = -Math.PI / 2; // vehicle Z-up -> three.js Y-up
    this.root.scale.setScalar(0.001); // mm -> m
    this.layers = {};
    this._buildBody();
    this._buildInterior();
    this._buildSeat();
    this._buildSteering();
    this._buildMirrors();
    this._buildManikin();
    this._buildSightlines();
    this._buildR46Zones();
  }

  /** UN ECE R46 minimum fields of vision on the ground (M1): Class I interior, Class III exterior.
   *  Distances are measured rearward from the driver's ocular points; "horizon" is drawn at 100 m. */
  _buildR46Zones() {
    const g = this.layer('r46_zones');
    const halfW = val(this.spec.vehicle.width_excl_mirrors) / 2;
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const zone = (x0, x1, y0, y1, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, Math.abs(y1 - y0)), mat(color));
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 3);
      m.userData.dx = (x0 + x1) / 2;
      return m;
    };
    const H = 100000;
    this.r46 = [
      zone(60000, H, -10000, 10000, 0x4aa3ff), // Class I: 20 m wide, from 60 m
      zone(20000, H, -halfW - 4000, -halfW, 0x33dd77), zone(4000, H, -halfW - 1000, -halfW, 0x33dd77), // Class III left
      zone(20000, H, halfW, halfW + 4000, 0xffaa33), zone(4000, H, halfW, halfW + 1000, 0xffaa33), // Class III right
    ];
    g.add(...this.r46);
  }

  layer(name) {
    if (!this.layers[name]) {
      const g = new THREE.Group();
      g.name = name;
      this.root.add(g);
      this.layers[name] = g;
    }
    return this.layers[name];
  }

  toWorld(p) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(V(p));
  }

  // ---------------------------------------------------------------- static
  _buildBody() {
    const veh = this.spec.vehicle, visual = this.spec.visual_reconstruction;
    const baseSections = val(visual.body_sections);
    const d = val(visual.exterior_refinement);
    const interpolate = (x, column) => smoothValue(baseSections, x, column);
    const glazingX = visual.glazing.flatMap((panel) => panel.points.map(([x]) => x));
    const sections = [
      ...baseSections,
      ...glazingX.map((x) => [x, ...[1, 2, 3, 4, 5].map((column) => interpolate(x, column))]),
    ].sort((a, b) => a[0] - b[0]);
    const paint = new THREE.MeshPhysicalMaterial({ ...val(d.materials.paint), side: THREE.DoubleSide });
    const inspection = val(visual.inspection_transparency);
    const doorPaint = paint.clone();
    doorPaint.transparent = true;
    doorPaint.opacity = inspection.door_opacity;
    doorPaint.depthWrite = false;
    const roofPaint = doorPaint.clone();
    roofPaint.opacity = inspection.roof_opacity;
    const sillZ = val(visual.body_sill_z_mm);
    const wheelRadius = val(veh.wheel_diameter) / 2;
    const arch = visual.wheel_arch;
    const archRadius = wheelRadius * val(arch.radius_ratio);
    const archCenterZ = wheelRadius * val(arch.center_z_ratio);
    const archAngle = Math.asin(THREE.MathUtils.clamp((sillZ - archCenterZ) / archRadius, -1, 1));
    const wheelXs = [0, val(veh.wheelbase)];
    const xSamples = new Set(sections.map(([x]) => x));
    const firstX = baseSections[0][0], lastX = baseSections[baseSections.length - 1][0];
    xSamples.add(inspection.door_x_min);
    xSamples.add(inspection.door_x_max);
    for (let i = 0; i < sections.length - 1; i++) {
      for (let step = 1; step < 8; step++) {
        xSamples.add(sections[i][0] + (sections[i + 1][0] - sections[i][0]) * step / 8);
      }
    }
    for (const wheelX of wheelXs) {
      for (let i = 0; i <= 32; i++) {
        const angle = archAngle + (Math.PI - 2 * archAngle) * (i / 32);
        xSamples.add(wheelX + archRadius * Math.cos(angle));
      }
    }
    const xs = [...xSamples].filter((x) => x >= firstX && x <= lastX).sort((a, b) => a - b);
    const body = this.layer('body');
    const lower = (x) => wheelXs.reduce((z, wheelX) => {
      const dx = x - wheelX;
      if (Math.abs(dx) >= archRadius) return z;
      return Math.max(z, archCenterZ + Math.sqrt(archRadius ** 2 - dx ** 2));
    }, sillZ);
    const sideWidth = (x, z) => {
      const t = THREE.MathUtils.clamp((z - sillZ) / (interpolate(x, 2) - sillZ), 0, 1);
      const endFade = Math.sin(Math.PI * (x - firstX) / (lastX - firstX));
      const sculpt = smoothValue(d.side_profile, t, 1);
      const flare = wheelXs.reduce((v, wheelX) => {
        const distance = Math.hypot(x - wheelX, z - archCenterZ) - archRadius;
        return v + val(d.fender_flare_mm) * Math.exp(-((distance / val(d.fender_falloff_mm)) ** 2));
      }, 0) * Math.sin(Math.PI * t);
      return interpolate(x, 4) - val(visual.body_side_inset_mm) + endFade * sculpt + flare;
    };
    const cornerX = (x, t) => {
      const fade = (distance) => (1 + Math.cos(Math.PI * Math.min(1, distance / val(d.corner_falloff_mm)))) / 2;
      const frontFade = fade(x - firstX), rearFade = fade(lastX - x);
      return x + frontFade * (val(d.front_corner_recession_mm) * (1 - t) ** 2 + val(d.front_top_recession_mm) * t ** 3) -
        rearFade * (val(d.rear_corner_recession_mm) * (1 - t) ** 2 + val(d.rear_top_recession_mm) * t ** 3);
    };
    for (const side of [-1, 1]) {
      for (const wheelX of wheelXs) {
        const points = [];
        for (let i = 0; i <= 32; i++) {
          const angle = archAngle + (Math.PI - 2 * archAngle) * (i / 32);
          const x = wheelX + archRadius * Math.cos(angle);
          points.push(V([
            x,
            side * sideWidth(x, archCenterZ + archRadius * Math.sin(angle)),
            archCenterZ + archRadius * Math.sin(angle),
          ]));
        }
        const lip = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, val(arch.fender_lip_mm) / 2, 8, false),
          paint,
        );
        lip.name = `painted_fender_lip_${wheelX}_${side}`;
        body.add(lip);
        const angles = Array.from({ length: 49 }, (_, i) => archAngle + (Math.PI - 2 * archAngle) * i / 48);
        const returnSkin = gridSurface(angles, 1, (angle, t) => {
          const x = wheelX + archRadius * Math.cos(angle), z = archCenterZ + archRadius * Math.sin(angle);
          return [x, side * (sideWidth(x, z) - t * val(d.arch_return_mm)), z];
        }, MAT.housing);
        returnSkin.name = `wheel_arch_return_${wheelX}_${side}`;
        body.add(returnSkin);
      }
      const sidePanel = gridSurface(xs, val(d.side_rows), (x, t) => {
        const z = lower(x) + (interpolate(x, 2) - lower(x)) * t;
        const height = (z - sillZ) / (interpolate(x, 2) - sillZ);
        return [cornerX(x, height), side * sideWidth(x, z), z];
      }, [paint, doorPaint], (a, b) => a >= inspection.door_x_min && b <= inspection.door_x_max ? 1 : 0);
      sidePanel.name = `painted_side_panel_${side}`;
      body.add(sidePanel);
    }

    const deckPoint = (x, t) => {
      const y = (2 * t - 1) * sideWidth(x, interpolate(x, 2));
      const lateral = Math.abs(2 * t - 1);
      let z = interpolate(x, 2) + (interpolate(x, 3) - interpolate(x, 2)) *
        (1 - lateral ** val(d.deck_roundness));
      if (x <= val(d.hood_end_x)) {
        z += val(d.hood_crown_mm) * Math.sin(Math.PI * t) * Math.sin(Math.PI * (x - firstX) / (val(d.hood_end_x) - firstX));
      }
      const windshield = visual.glazing.find((p) => p.name === 'windshield').points;
      const cowlBlend = THREE.MathUtils.clamp((x - val(d.cowl_start_x)) / (val(d.hood_end_x) - val(d.cowl_start_x)), 0, 1);
      if (x <= val(d.hood_end_x) && cowlBlend > 0) {
        const outer = Math.max(0, (Math.abs(y) - Math.abs(windshield[0][1])) /
          (sideWidth(x, interpolate(x, 2)) - Math.abs(windshield[0][1])));
        const cowlZ = interpolate(x, 2) + (windshield[0][2] - interpolate(x, 2)) * Math.cos(outer * Math.PI / 2);
        z += cowlBlend * (cowlZ - z);
      }
      if (x >= val(d.tail_deck_start_x) && x < val(d.tail_cowl_end_x)) {
        const rearWindow = visual.glazing.find((p) => p.name === 'rear_window').points;
        const innerWidth = Math.abs(rearWindow[2][1]);
        const outer = Math.max(0, (Math.abs(y) - innerWidth) / (sideWidth(x, interpolate(x, 2)) - innerWidth));
        const cowlZ = interpolate(x, 2) + (rearWindow[2][2] - interpolate(x, 2)) * Math.cos(outer * Math.PI / 2);
        const blend = (val(d.tail_cowl_end_x) - x) / (val(d.tail_cowl_end_x) - val(d.tail_deck_start_x));
        z += blend * (cowlZ - z);
      }
      return [x + (cornerX(x, 1) - x) * lateral ** 4, y, z];
    };
    const hood = gridSurface(xs.filter((x) => x <= val(d.hood_end_x)), val(d.deck_rows), deckPoint, paint);
    hood.name = 'sculpted_hood';
    body.add(hood);
    const tailDeck = gridSurface(xs.filter((x) => x >= val(d.tail_deck_start_x)), val(d.deck_rows),
      deckPoint, paint);
    tailDeck.name = 'liftgate_upper_shoulder';
    body.add(tailDeck);
    const roof = this.layer('body_roof');
    const roofRows = d.roof_sections;
    const pano = visual.glazing.find((p) => p.name === 'panoramic_roof').points;
    const roofXs = [...new Set([...xs, ...roofRows.map((r) => r[0])])]
      .filter((x) => x >= roofRows[0][0] && x <= roofRows[roofRows.length - 1][0]).sort((a, b) => a - b);
    const apertureMin = pano[0][0], apertureMax = pano[2][0];
    for (const side of [-1, 1]) {
      for (const [index, [min, max, aperture]] of [
        [roofRows[0][0], apertureMin, false], [apertureMin, apertureMax, true],
        [apertureMax, roofRows[roofRows.length - 1][0], false],
      ].entries()) {
        const mesh = gridSurface(roofXs.filter((x) => x >= min && x <= max), val(d.roof_rows), (x, t) => {
          const outerY = smoothValue(roofRows, x, 1), edgeZ = smoothValue(roofRows, x, 2);
          const centerZ = smoothValue(roofRows, x, 3);
          const ratio = (x - apertureMin) / (apertureMax - apertureMin);
          const innerY = aperture ? Math.abs(pano[0][1]) + ratio * (Math.abs(pano[2][1]) - Math.abs(pano[0][1])) : 0;
          const innerZ = aperture ? pano[0][2] + ratio * (pano[2][2] - pano[0][2]) : centerZ;
          return [x, side * (outerY + (innerY - outerY) * t), edgeZ + (innerZ - edgeZ) * Math.sin(t * Math.PI / 2)];
        }, roofPaint);
        mesh.name = `fitted_roof_surround_${index}_${side}`;
        roof.add(mesh);
      }
    }

    for (const [section, direction, name] of [
      [baseSections[0], -1, 'front_fascia'],
      [baseSections[baseSections.length - 1], 1, 'tailgate'],
    ]) {
      const x = section[0];
      const samples = Array.from({ length: val(d.deck_rows) + 1 }, (_, i) => i / val(d.deck_rows));
      const fascia = gridSurface(samples, val(d.end_rows), (u, t) => {
        const upper = deckPoint(x, u);
        const top = direction === 1 ? interpolate(x, 2) + (interpolate(x, 3) - interpolate(x, 2)) *
          (1 - Math.abs(2 * u - 1) ** val(d.deck_roundness)) : upper[2];
        const corners = (cornerX(x, t) - x) * Math.abs(2 * u - 1) ** 4;
        const profile = direction < 0 ? smoothValue(d.front_end_profile, t, 1) : 0;
        return [x + corners + direction * (val(d.end_crown_mm) * Math.sin(Math.PI * t) + profile) * Math.sin(Math.PI * u),
          upper[1], sillZ + (top - sillZ) * t];
      }, paint);
      fascia.name = name;
      body.add(fascia);
    }
    // Narrow belt returns meet the actual window corners, rather than leaving a slit.
    for (const side of [-1, 1]) {
      const belt = d.belt_sections;
      const beltXs = [...new Set([...xs, ...belt.map((r) => r[0])])]
        .filter((x) => x >= belt[0][0] && x <= belt[belt.length - 1][0]).sort((a, b) => a - b);
      const mesh = gridSurface(beltXs, 2, (x, t) => [
        x, side * (sideWidth(x, interpolate(x, 2)) * (1 - t) + smoothValue(belt, x, 1) * t),
        interpolate(x, 2) * (1 - t) + smoothValue(belt, x, 2) * t,
      ], [paint, doorPaint], (a, b) => a >= inspection.door_x_min && b <= inspection.door_x_max ? 1 : 0);
      mesh.name = `window_belt_return_${side}`;
      body.add(mesh);
    }
    for (const pillar of visual.pillars) {
      for (const side of [-1, 1]) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(
          pillar.points.flatMap(([x, y, z]) => [x, side * y, z]), 3,
        ));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, paint);
        mesh.name = `${pillar.name}_${side}`;
        roof.add(mesh);
      }
    }
    roof.traverse((object) => {
      if (object.isMesh) object.material = roofPaint;
    });

    this._buildRoadWheels();
    this._buildPhotoDetails();
    this._buildExteriorRefinement(paint, (x, y) => deckPoint(x,
      (y / sideWidth(x, interpolate(x, 2)) + 1) / 2)[2]);
  }

  _buildExteriorRefinement(paint, hoodHeight) {
    const d = val(this.spec.visual_reconstruction.exterior_refinement);
    const layer = this.layer('exterior_details');
    const materials = Object.fromEntries(Object.entries(d.materials).map(([name, p]) => [
      name, name === 'paint' ? paint : new THREE.MeshStandardMaterial(val(p)),
    ]));
    const badge = new THREE.Mesh(
      new THREE.TorusGeometry(val(d.badge.radius), val(d.badge.tube), 8, 40), materials.satin,
    );
    badge.rotation.y = Math.PI / 2;
    badge.position.copy(V(d.badge.center));
    badge.name = 'nose_emblem_ring';
    layer.add(badge);
    for (const part of d.panels) {
      for (const side of part.mirror_y ? [-1, 1] : [1]) {
        const mesh = contourSolid(part.outline, part.rings, val(part.radius), materials[part.material]);
        if (part.sweep_x) {
          const positions = mesh.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            positions.setZ(i, positions.getZ(i) + smoothValue(part.sweep_x, positions.getX(i), 1));
          }
          mesh.geometry.computeVertexNormals();
        }
        setBasis(mesh, [0, 1, 0], [0, 0, 1], [1, 0, 0]);
        mesh.scale.x = side;
        mesh.position.copy(V([part.center[0], side * part.center[1], part.center[2]]));
        mesh.name = `${part.name}_${side}`;
        layer.add(mesh);
      }
    }
    for (const stroke of d.strokes) {
      for (const side of stroke.mirror_y ? [-1, 1] : [1]) {
        const points = stroke.points.map(([x, y, z]) => V([
          x, side * y, stroke.surface === 'hood' ? hoodHeight(x, y) + val(stroke.surface_offset_mm) : z,
        ]));
        const path = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 8, val(stroke.radius), 8, false),
          materials[stroke.material]);
        mesh.name = `${stroke.name}_${side}`;
        layer.add(mesh);
      }
    }
  }

  _buildRoadWheels() {
    const veh = this.spec.vehicle, d = this.spec.visual_reconstruction.wheel_detail;
    const radius = val(veh.wheel_diameter) / 2, halfWidth = val(veh.tyre_width) / 2;
    const rimRadius = radius * val(d.rim_radius_ratio), face = halfWidth + val(d.face_offset_mm);
    const materials = Object.fromEntries(Object.entries(d.materials).map(([name, parameters]) => [
      name, new THREE.MeshStandardMaterial(parameters),
    ]));
    const template = new THREE.Group();
    const addMesh = (name, geometry, material, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.z = z;
      template.add(mesh);
      return mesh;
    };
    const lathe = (points) => {
      const geometry = new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(...p)), 96);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    };
    const cylinder = (r, depth) => {
      const geometry = new THREE.CylinderGeometry(r, r, depth, 64);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    };
    addMesh('tire', lathe(d.tire_profile.map(([r, z]) => [r * radius, z * halfWidth])), materials.rubber);
    const wall = val(d.barrel_wall_mm), barrelDepth = val(d.barrel_depth_mm);
    addMesh('rim_barrel', lathe([
      [rimRadius - wall, -barrelDepth], [rimRadius, -barrelDepth],
      [rimRadius, 0], [rimRadius - wall, 0], [rimRadius - wall, -barrelDepth],
    ]), materials.recess, face);
    addMesh('rim_lip', new THREE.TorusGeometry(rimRadius, val(d.rim_tube_mm), 10, 96), materials.alloy, face);
    for (const offset of d.tread_groove_offsets) {
      addMesh('tread_groove', new THREE.TorusGeometry(radius - val(d.tread_groove_radius_mm) / 2, val(d.tread_groove_radius_mm), 6, 96), materials.groove, offset * halfWidth);
    }
    for (const sign of [-1, 1]) {
      for (const ratio of d.sidewall_ring_ratios) {
        addMesh('sidewall_bead', new THREE.TorusGeometry(radius * ratio, val(d.sidewall_ring_radius_mm), 6, 96), materials.rubber, sign * halfWidth * 0.99);
      }
    }
    const tread = [];
    for (let i = 0; i < val(d.tread_count); i++) {
      const angle = i * 2 * Math.PI / val(d.tread_count);
      for (const sign of [-1, 1]) {
        for (const [r, z, shift] of d.tread_groove_profile) {
          tread.push(Math.cos(angle + sign * shift) * radius * r, Math.sin(angle + sign * shift) * radius * r, sign * z * halfWidth);
        }
      }
    }
    const treadGeometry = new THREE.BufferGeometry();
    // Each three-point shoulder groove is a separate polyline.
    const segments = [];
    for (let i = 0; i < tread.length; i += 9) segments.push(...tread.slice(i, i + 6), ...tread.slice(i + 3, i + 9));
    treadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const treadLines = new THREE.LineSegments(treadGeometry, new THREE.LineBasicMaterial({ color: d.materials.groove.color }));
    treadLines.name = 'tread_shoulders';
    template.add(treadLines);
    addMesh('brake_disc', cylinder(rimRadius * val(d.brake_radius_ratio), val(d.brake_depth_mm)), materials.brake, face - val(d.brake_recess_mm));
    const caliper = addMesh('brake_caliper', new THREE.BoxGeometry(...d.caliper_size_mm), materials.caliper, face - val(d.brake_recess_mm) / 2);
    caliper.position.x = -rimRadius * val(d.caliper_offset_ratio);
    addMesh('wheel_hub', cylinder(val(d.hub_radius_mm), val(d.hub_depth_mm)), materials.recess, face - val(d.spoke_root_recess_mm));
    for (let i = 0; i < val(d.spoke_count); i++) {
      for (const side of [-1, 1]) {
        const points = d.spoke_profile.map(([r, t]) => [r * rimRadius, side * t * rimRadius]);
        const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points.map((p) => new THREE.Vector2(...p))), {
          depth: val(d.spoke_depth_mm), bevelEnabled: false,
        });
        const positions = geometry.getAttribute('position');
        for (let j = 0; j < positions.count; j++) {
          positions.setZ(j, positions.getZ(j) - val(d.spoke_depth_mm) - (1 - positions.getX(j) / rimRadius) * val(d.spoke_root_recess_mm));
        }
        geometry.computeVertexNormals();
        const angle = i * 2 * Math.PI / val(d.spoke_count);
        const spoke = addMesh('split_spoke_dark', geometry, materials.recess, face);
        spoke.rotation.z = angle;
        const center = new THREE.Vector2();
        for (const p of points) center.add(new THREE.Vector2(...p));
        center.divideScalar(points.length);
        const facePoints = points.map(([x, y]) => [
          center.x + (x - center.x) * val(d.spoke_face_scale),
          center.y + (y - center.y) * val(d.spoke_face_scale),
        ]);
        const faceGeometry = new THREE.ShapeGeometry(new THREE.Shape(facePoints.map((p) => new THREE.Vector2(...p))));
        const facePositions = faceGeometry.getAttribute('position');
        for (let j = 0; j < facePositions.count; j++) {
          facePositions.setZ(j, -(1 - facePositions.getX(j) / rimRadius) * val(d.spoke_root_recess_mm) + val(d.spoke_face_offset_mm));
        }
        faceGeometry.computeVertexNormals();
        const machined = addMesh('split_spoke_machined', faceGeometry, materials.alloy, face);
        machined.rotation.z = angle;
      }
    }
    const capZ = face - val(d.spoke_root_recess_mm) + val(d.hub_depth_mm) / 2;
    addMesh('center_cap', cylinder(val(d.cap_radius_mm), val(d.cap_depth_mm)), materials.alloy, capZ);
    for (let i = 0; i < val(d.bolt_count); i++) {
      const angle = i * 2 * Math.PI / val(d.bolt_count);
      const bolt = addMesh('lug_bolt', cylinder(val(d.bolt_radius_mm), val(d.bolt_depth_mm)), materials.alloy, capZ);
      bolt.position.x = Math.cos(angle) * val(d.bolt_circle_radius_mm);
      bolt.position.y = Math.sin(angle) * val(d.bolt_circle_radius_mm);
    }
    const valve = addMesh('tire_valve', cylinder(val(d.valve_radius_mm), val(d.valve_length_mm)), materials.groove, face);
    valve.position.y = -rimRadius + val(d.rim_tube_mm) * 2;
    const wheels = this.layer('wheels');
    for (const [axle, x, track] of [
      ['front', 0, val(veh.track_front)], ['rear', val(veh.wheelbase), val(veh.track_rear)],
    ]) {
      for (const side of [-1, 1]) {
        const wheel = template.clone(true);
        wheel.name = `road_wheel_${axle}_${side < 0 ? 'left' : 'right'}`;
        wheel.rotation.x = -side * Math.PI / 2;
        wheel.position.set(x, side * track / 2, radius);
        wheels.add(wheel);
      }
    }
  }

  _buildPhotoDetails() {
    const visual = this.spec.visual_reconstruction;
    const glazing = this.layer('body_glazing'), details = this.layer('exterior_details');
    const paneMaterial = new THREE.MeshStandardMaterial({
      ...visual.glazing_material, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const panel of visual.glazing) {
      for (const sign of panel.mirror_y ? [1, -1] : [1]) {
        const offset = panel.mirror_y ? val(visual.glazing_surface_offset_mm) : 0;
        const d = val(visual.exterior_refinement);
        const points = panel.points.map(([x, y, z]) => V([
          x, panel.mirror_y ? sign * (Math.abs(y) + offset) : y, z,
        ]));
        const material = paneMaterial.clone();
        if (panel.name === 'panoramic_roof') material.opacity = val(visual.roof_glass_opacity);
        if (panel.name === 'front_side' || panel.name === 'rear_side') {
          material.opacity = val(visual.inspection_transparency).door_opacity;
        }
        const samples = Array.from({ length: val(d.glass_rows) + 1 }, (_, i) => i / val(d.glass_rows));
        const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[3].clone().sub(points[0])).normalize();
        if (panel.mirror_y && normal.y * sign < 0 || !panel.mirror_y && normal.z < 0) normal.negate();
        const mesh = gridSurface(samples, val(d.glass_rows), (u, t) => {
          const a = points[0].clone().lerp(points[1], u), b = points[3].clone().lerp(points[2], u);
          return a.lerp(b, t).addScaledVector(normal, val(d.glass_bow_mm) * Math.sin(Math.PI * u) * Math.sin(Math.PI * t)).toArray();
        }, material);
        mesh.name = `${panel.name}_${sign}`;
        glazing.add(mesh);
      }
    }
    for (const stroke of visual.strokes) {
      if (val(visual.exterior_refinement).replaced_strokes.includes(stroke.name)) continue;
      for (const sign of stroke.mirror_y ? [1, -1] : [1]) {
        const points = stroke.points.map(([x, y, z]) => V([x, sign * y, z]));
        const path = new THREE.CurvePath();
        for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 4, val(stroke.radius), 8, false), MAT[stroke.material]);
        mesh.name = `${stroke.name}_${sign}`;
        details.add(mesh);
      }
    }
    for (const part of visual.end_trim) {
      const mesh = roundedBox([part.size[1], part.size[2], part.size[0]], val(part.radius), MAT.housing);
      setBasis(mesh, [0, 1, 0], [0, 0, 1], [1, 0, 0]);
      mesh.position.copy(V(part.center));
      mesh.name = part.name;
      details.add(mesh);
    }
  }

  _buildDashboard() {
    const d = this.spec.visual_reconstruction.dashboard, g = this.layer('cabin_details');
    const materials = Object.fromEntries(Object.entries(d.materials).map(([name, parameters]) => [
      name, new THREE.MeshStandardMaterial(parameters),
    ]));
    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 256;
    woodCanvas.height = 64;
    const context = woodCanvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is required for dashboard trim.');
    context.fillStyle = '#9b8973';
    context.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) {
      const shade = Math.round(100 + 35 * Math.sin(i * 2.7));
      context.strokeStyle = `rgba(${shade},${shade},${shade},0.22)`;
      context.beginPath();
      context.moveTo(i * 2.9, 0);
      context.bezierCurveTo(i * 2.9 + 3, 20, i * 2.9 - 3, 40, i * 2.9 + 1, 64);
      context.stroke();
    }
    const woodTexture = new THREE.CanvasTexture(woodCanvas);
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    materials.wood.map = woodTexture;
    for (const part of d.fascia) {
      const mesh = profilePrism(part.profile_xz, val(part.width), val(part.corner_radius), materials[part.material]);
      mesh.name = part.name;
      g.add(mesh);
    }
    const console = d.console;
    for (const side of [-1, 1]) {
      const wall = profilePrism(console.side_profile_xz, val(console.wall_thickness), val(console.corner_radius), materials.lower);
      wall.position.y = side * (val(console.width) - val(console.wall_thickness)) / 2;
      wall.name = `console_open_side_${side}`;
      g.add(wall);
    }
    for (const part of [...d.trim_strips, ...console.parts]) {
      const mesh = roundedBox(part.size, val(part.radius), materials[part.material]);
      mesh.position.copy(V(part.center));
      mesh.name = part.name;
      g.add(mesh);
    }
    const roller = console.roller;
    const control = new THREE.Mesh(new THREE.CylinderGeometry(val(roller.radius), val(roller.radius), val(roller.length), 24), materials.metal);
    control.position.copy(V(roller.center));
    control.name = 'console_volume_roller';
    g.add(control);
    for (let i = 0; i < val(roller.rib_count); i++) {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(val(roller.rib_radius), val(roller.rib_radius), val(roller.rib_width), 24), materials.metal);
      rib.position.copy(control.position);
      rib.position.y += (i / (val(roller.rib_count) - 1) - 0.5) * val(roller.length);
      g.add(rib);
    }
    const tweeter = d.tweeter, speaker = new THREE.Group();
    speaker.name = 'dashboard_tweeter';
    speaker.position.copy(V(tweeter.center));
    const mount = roundedBox(tweeter.mount_size, val(tweeter.mount_radius), materials.upper);
    mount.position.copy(V(tweeter.mount_offset));
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(val(tweeter.radius), val(tweeter.radius), val(tweeter.depth), 40), MAT.housing);
    housing.rotation.z = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(val(tweeter.radius), 40), materials.metal);
    face.rotation.y = Math.PI / 2;
    face.position.x = val(tweeter.depth) / 2 + val(tweeter.face_offset);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(val(tweeter.rim_radius), val(tweeter.rim_tube), 8, 48), materials.metal);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = face.position.x;
    speaker.add(mount, housing, face, rim);
    const spacing = val(tweeter.hole_spacing), radius = val(tweeter.radius) - val(tweeter.rim_tube) * 2;
    const holeGeometry = new THREE.CircleGeometry(val(tweeter.hole_radius), 8);
    for (let row = -Math.floor(radius / spacing); row <= Math.floor(radius / spacing); row++) {
      for (let col = -Math.floor(radius / spacing); col <= Math.floor(radius / spacing); col++) {
        const y = col * spacing + (Math.abs(row) % 2) * spacing / 2, z = row * spacing;
        if (Math.hypot(y, z) > radius) continue;
        const hole = new THREE.Mesh(holeGeometry, MAT.housing);
        hole.rotation.y = Math.PI / 2;
        hole.position.set(face.position.x + val(tweeter.face_offset), y, z);
        speaker.add(hole);
      }
    }
    g.add(speaker);
  }

  _buildInterior() {
    const sp = this.spec, g = this.layer('interior');
    const floorZ = val(sp.vehicle.floor_z);
    const floor = box(2600, 1600, 20, MAT.floor);
    floor.position.set(1500, 0, floorZ - 10);
    g.add(floor);

    this._buildDashboard();

    const detail = sp.visual_reconstruction.dashboard.display;
    for (const key of ['center', 'driver']) {
      const d = sp.displays[key];
      const t = THREE.MathUtils.degToRad(d.tilt_deg || 0);
      const n = [Math.cos(t), 0, Math.sin(t)];
      const grp = new THREE.Group();
      grp.position.copy(V([d.center.x, d.center.y, d.center.z]));
      setBasis(grp, ...basisFromNormal(n));
      const texture = displayTexture(key, detail.texture_size);
      const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.65, roughness: 0.32 });
      const scr = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape([
        [-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2],
      ], val(detail.corner_radius))), material);
      const positions = scr.geometry.getAttribute('position'), uv = scr.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / d.w + 0.5, positions.getY(i) / d.h + 0.5);
      scr.position.z = val(detail.surface_offset_mm);
      scr.name = `screen_${key}`;
      const bezel = val(detail.bezel_mm), depth = val(detail.housing_depth_mm);
      const back = roundedBox([d.w + 2 * bezel, d.h + 2 * bezel, depth], val(detail.corner_radius) + bezel, MAT.housing);
      back.position.z = -depth / 2;
      const surround = roundedBox([d.w + 2 * bezel + val(detail.surface_offset_mm), d.h + 2 * bezel + val(detail.surface_offset_mm), depth / 2], val(detail.corner_radius) + bezel, MAT.rimMetal);
      surround.position.z = -depth / 2;
      grp.add(surround, back, scr);
      grp.name = `display_${key}`;
      g.add(grp);
    }

    const ahp = sp.pedals.accelerator_heel_point;
    const pedal = box(40, 75, 230, MAT.trim);
    pedal.position.set(ahp.x - 150, ahp.y, ahp.z + 120);
    pedal.rotation.y = THREE.MathUtils.degToRad(-35);
    g.add(pedal);
  }

  _buildSeat() {
    const s = this.spec.seat, g = this.layer('seat');
    const d = val(this.spec.visual_reconstruction.seat_detail);
    const materials = Object.fromEntries(Object.entries(d.materials).map(([key, properties]) =>
      [key, new THREE.MeshStandardMaterial(properties)]));
    for (const side of [-1, 1]) {
      const rail = box(s.fore_aft_mm.max - s.fore_aft_mm.min + val(d.rails.length), ...d.rails.section, MAT.seatRail);
      const midX = s.sgrp.x + (s.fore_aft_mm.max + s.fore_aft_mm.min) / 2 + val(d.rails.x_offset);
      rail.position.set(midX, s.sgrp.y + side * val(d.rails.y_offset), val(this.spec.vehicle.floor_z) + val(d.rails.floor_offset));
      rail.rotation.y = THREE.MathUtils.degToRad(-val(s.rail_angle_deg));
      g.add(rail);
    }
    this.seat = new THREE.Group();
    this.seat.name = 'seat_h_point_frame';
    this.cushion = new THREE.Group();
    this.cushion.name = 'seat_cushion_tilt_frame';
    this.back = new THREE.Group();
    this.back.name = 'seat_back_recline_frame';
    this.back.position.copy(V(d.back_pivot));
    const seamMaterial = new THREE.LineBasicMaterial({ color: d.seam_color });
    for (const part of d.parts) {
      const metric = s[part.metric];
      const dimensions = part.metric === 'cushion'
        ? [metric.length, metric.width, metric.thickness]
        : [metric.width, metric.height, metric.thickness];
      const size = dimensions.map((v, i) => v * part.size_ratio[i]);
      const points = d.contours[part.contour].map(([x, y]) => [x * size[0], y * size[1]]);
      const rings = d.rings[part.rings].map(([z, sx, sy, dx, dy]) => [z * size[2], sx, sy, dx * size[0], dy * size[1]]);
      const mesh = contourSolid(points, rings, val(part.radius), materials[part.material]);
      mesh.name = `seat_${part.name}`;
      const frame = new THREE.Group();
      frame.position.copy(V(part.center));
      if (part.metric !== 'cushion') setBasis(frame, [0, 1, 0], [0, 0, 1], [1, 0, 0]);
      frame.add(mesh);
      (part.metric === 'cushion' ? this.cushion : this.back).add(frame);
      if (part.seam_ring !== undefined) {
        const [z, sx, sy, dx, dy] = rings[part.seam_ring];
        const edge = roundedShape(points, val(part.radius)).getPoints(10);
        const seam = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(edge.map((p) =>
          new THREE.Vector3(p.x * sx + dx, p.y * sy + dy, z + val(part.seam_offset)))), seamMaterial);
        seam.name = `seat_${part.name}_seam`;
        frame.add(seam);
      }
    }
    for (const seam of d.panel_seams) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(seam.points.map(V)), seamMaterial);
      line.name = `seat_${seam.name}`;
      this.back.add(line);
    }
    const pedestal = roundedBox(d.pedestal.size, val(d.pedestal.radius), MAT.seatRail);
    pedestal.name = 'seat_height_pedestal';
    this.pedestal = pedestal;
    this.seat.add(this.cushion, this.back, pedestal);
    g.add(this.seat);
    this.hMarker = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), MAT.marker);
    this.layer('markers').add(this.hMarker);
  }

  _buildSteering() {
    const st = this.spec.steering, g = this.layer('steering');
    const R = val(st.rim_diameter) / 2, T = val(st.rim_thickness) / 2;
    this.wheelFrame = new THREE.Group();
    this.wheelSpin = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, T, 18, 72), MAT.wheel);
    const trim = this.spec.visual_reconstruction.dashboard.steering_trim;
    const hub = roundedBox(trim.hub_size, val(trim.hub_radius), MAT.dash);
    hub.position.copy(V(trim.hub_center));
    this.wheelSpin.add(rim, hub);
    for (const ang of [0, Math.PI, -Math.PI / 2]) {
      const spoke = box(R - 60, 34, 16, MAT.wheel);
      spoke.position.set(Math.cos(ang) * (R / 2 + 25), Math.sin(ang) * (R / 2 + 25), -12);
      spoke.rotation.z = ang;
      this.wheelSpin.add(spoke);
    }
    for (const sign of [-1, 1]) {
      const buttons = roundedBox(trim.switch_size, val(trim.switch_radius), MAT.housing);
      buttons.position.copy(V(trim.switch_offset));
      buttons.position.x *= sign;
      this.wheelSpin.add(buttons);
    }
    const tdc = box(10, 26, T * 2 + 2, new THREE.MeshBasicMaterial({ color: 0xff9900 }));
    tdc.position.set(0, R, 0);
    this.wheelSpin.add(tdc); // 12 o'clock marker shows wheel angle
    this.wheelFrame.add(this.wheelSpin);
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(38, 48, 1, 20), MAT.trim);
    g.add(this.wheelFrame, this.column);
  }

  _buildMirrors() {
    const g = this.layer('mirrors');
    const detail = val(this.spec.visual_reconstruction.mirror_detail);
    const capMaterial = new THREE.MeshStandardMaterial(detail.cap_material);
    this.mirrors = {};
    for (const k of K.MIRRORS) {
      const m = this.spec.mirrors[k], c = [m.glass_center.x, m.glass_center.y, m.glass_center.z];
      const d = detail[k === 'interior' ? 'interior' : 'exterior'];
      const grp = new THREE.Group();
      grp.name = `mirror_${k}_normal_pivot`;
      grp.position.copy(V(c));
      // Local XY is the glass plane; +Z remains the kinematic glass normal.
      // At zero yaw/pitch local X = vehicle +Y: reflect the outline on the left.
      const side = k === 'left' ? -1 : 1;
      const points = d.outline.map(([x, y]) => [x * side * m.glass_size.w, y * m.glass_size.h]);
      if (side < 0) points.reverse();
      const shape = roundedShape(points, val(d.glass_radius));
      const glass = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), MAT.glass);
      glass.name = `mirror_${k}_glass`;
      const shellPoints = points.map(([x, y]) => [x * (m.glass_size.w + val(d.rim_width) * 2) / m.glass_size.w,
        y * (m.glass_size.h + val(d.rim_width) * 2) / m.glass_size.h]);
      const housing = contourSolid(shellPoints, d.shell_rings, val(d.housing_radius), k === 'interior' ? MAT.housing : capMaterial);
      housing.name = `mirror_${k}_sculpted_housing`;
      const rim = contourSolid(shellPoints, d.rim_rings, val(d.housing_radius), MAT.housing);
      rim.name = `mirror_${k}_rim`;
      grp.add(glass, housing, rim);
      g.add(grp);
      const mount = new Limb(val(d.mount_radius), MAT.housing, g);
      const anchor = k === 'interior'
        ? [c[0] + d.mount_offset[0], c[1], val(this.spec.vehicle.roof_inner_z) + d.mount_offset[2]]
        : [c[0] + d.mount_offset[0], Math.sign(c[1]) * (val(this.spec.vehicle.width_excl_mirrors) / 2 + d.mount_offset[1]), c[2] + d.mount_offset[2]];
      mount.mesh.name = `mirror_${k}_mount_arm`;
      mount.set(K.add(c, d.mount_start_offset), anchor);
      const trim = roundedBox(d.mount_trim_size, val(d.mount_trim_radius), MAT.housing);
      trim.name = `mirror_${k}_mount_trim`;
      trim.position.copy(V(anchor));
      g.add(trim);
      this.mirrors[k] = { group: grp, center: c, glass };
    }
  }

  _buildManikin() {
    const g = this.layer('manikin');
    const L = (mat = MAT.cloth) => new Limb(1, mat, g);
    this.mk = {
      neck: L(MAT.skin),
      thighL: L(), thighR: L(), shankL: L(), shankR: L(), footL: L(MAT.trim), footR: L(MAT.trim),
      uArmL: L(), uArmR: L(), fArmL: L(MAT.skin), fArmR: L(MAT.skin),
      shoulders: L(),
    };
    this.bodyVolumes = {};
    for (const name of ['chest', 'abdomen', 'pelvis']) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), MAT.cloth);
      mesh.name = `driver_${name}`;
      this.bodyVolumes[name] = mesh;
      g.add(mesh);
    }
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), MAT.skin);
    this.head.name = 'driver_head';
    this.eyeMarker = new THREE.Mesh(new THREE.SphereGeometry(val(this.spec.manikin_rendering.eye_marker_radius), 12, 10), new THREE.MeshBasicMaterial({ color: 0x00e0ff }));
    g.add(this.head);
    this.layer('markers').add(this.eyeMarker);
    const e = this.spec.eyellipse_95;
    this.eyellipse = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), MAT.eyellipse);
    this.eyellipse.scale.set(e.x / 2, e.y / 2, e.z / 2);
    this.layer('eyellipse').add(this.eyellipse);
  }

  _buildSightlines() {
    const g = this.layer('sightlines');
    this.lines = {};
    const mk = (name, color) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
      line.frustumCulled = false;
      g.add(line);
      this.lines[name] = line;
    };
    for (const k of K.MIRRORS) mk(k, 0x33dd77);
    mk('cluster_top', 0xffcc00);
    mk('cluster_bottom', 0xffcc00);
  }

  _setLine(name, pts, ok) {
    const line = this.lines[name], arr = line.geometry.attributes.position.array;
    for (let i = 0; i < 3; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      arr.set(p, i * 3);
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.material.color.set(ok ? (name.startsWith('cluster') ? 0xffcc00 : 0x33dd77) : 0xff3355);
  }

  // ----------------------------------------------------------------- update
  update(state, manikin) {
    const sp = this.spec, a = state;
    const H = K.hPoint(sp, a);
    const D2R = THREE.MathUtils.degToRad;

    // Seat
    this.seat.position.copy(V(H));
    this.cushion.rotation.y = D2R(a.seat_cushion_tilt);
    this.back.rotation.y = D2R(a.seat_back_angle);
    const pedestal = val(sp.visual_reconstruction.seat_detail).pedestal;
    this.pedestal.scale.z = Math.max(1, H[2] - (val(sp.vehicle.floor_z) + val(pedestal.floor_offset)) - val(pedestal.top_offset));
    this.pedestal.position.set(val(pedestal.x_offset), 0, -(this.pedestal.scale.z / 2) - val(pedestal.top_offset));
    this.hMarker.position.copy(V(H));

    // Steering
    const wc = K.wheelCenter(sp, a), ax = K.steeringAxis(sp, a), up = K.wheelUp(sp, a);
    this.wheelFrame.position.copy(V(wc));
    setBasis(this.wheelFrame, K.cross(up, ax), up, ax);
    this.wheelSpin.rotation.z = D2R(a.steer_wheel_angle);
    const colStart = K.steeringPivot(sp), colEnd = K.sub(wc, K.scale(ax, 60));
    const cd = K.sub(colEnd, K.add(colStart, K.scale(ax, -120)));
    this.column.position.copy(V(K.scale(K.add(colEnd, K.add(colStart, K.scale(ax, -120))), 0.5)));
    this.column.scale.set(1, K.norm(cd), 1);
    this.column.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(K.unit(cd)));

    // Mirrors
    for (const k of K.MIRRORS) {
      const n = K.mirrorNormal(...K.mirrorAngles(a, k));
      setBasis(this.mirrors[k].group, ...basisFromNormal(n));
    }

    // Manikin
    const m = sp.manikins[manikin];
    this.layers.manikin.userData.driverProfile = { id: manikin, dimensions: m };
    const b = m.body, render = sp.manikin_rendering;
    const td = K.torsoDir(a.seat_back_angle);
    const eye = K.eyePoint(sp, a, manikin);
    const neckBase = K.add(H, K.scale(td, m.h_to_shoulder + val(render.neck_base_offset)));
    const headC = [eye[0] + b.head_depth * render.head_eye_offset_ratio, eye[1], eye[2] + (m.head_above_eye - b.head_below_eye) / 2];
    const hipL = [H[0], H[1] - m.hip_half_width, H[2]], hipR = [H[0], H[1] + m.hip_half_width, H[2]];
    const shL = K.shoulderPoint(sp, a, manikin, -1), shR = K.shoulderPoint(sp, a, manikin, 1);
    const ahp = sp.pedals.accelerator_heel_point;
    const ankleR = [ahp.x, ahp.y, ahp.z + m.ankle_height];
    const ankleL = [ahp.x + render.left_ankle_offset[0], H[1] + render.left_ankle_offset[1], ahp.z + m.ankle_height + render.left_ankle_offset[2]];
    const kneeHint = [-0.35, 0, 1];
    const reachLeg = m.thigh + m.shank - 1;
    const aL = K.reachable(hipL, ankleL, reachLeg), aR = K.reachable(hipR, ankleR, reachLeg);
    const kneeL = K.twoBoneIK(hipL, aL, m.thigh, m.shank, kneeHint);
    const kneeR = K.twoBoneIK(hipR, aR, m.thigh, m.shank, kneeHint);

    // Hands at 9 and 3 o'clock, following the wheel within ±120°
    const R = val(sp.steering.rim_diameter) / 2;
    const side = K.cross(up, ax); // wheel-plane lateral (points to +Y at 0°)
    const ang = D2R(Math.max(-120, Math.min(120, a.steer_wheel_angle)));
    const rimPt = (base) => {
      const b = base + ang;
      return K.add(wc, K.add(K.scale(side, Math.cos(b) * R), K.scale(up, Math.sin(b) * R)));
    };
    // In this basis, angle 0 = +side (+Y, driver's right = 3 o'clock); 180° = 9 o'clock.
    const handR = K.reachable(shR, rimPt(0), m.upper_arm + m.forearm_hand - 1);
    const handL = K.reachable(shL, rimPt(Math.PI), m.upper_arm + m.forearm_hand - 1);
    const elbowL = K.twoBoneIK(shL, handL, m.upper_arm, m.forearm_hand, [0.4, -0.6, -1]);
    const elbowR = K.twoBoneIK(shR, handR, m.upper_arm, m.forearm_hand, [0.4, 0.6, -1]);

    const s = this.mk;
    const volume = (name, fraction, depth, halfWidth, halfHeight) => {
      const mesh = this.bodyVolumes[name];
      mesh.position.copy(V(K.add(H, K.scale(td, m.h_to_shoulder * fraction))));
      setBasis(mesh, [td[2], 0, -td[0]], [0, 1, 0], td);
      mesh.scale.set(depth / 2, halfWidth, halfHeight);
    };
    volume('chest', render.chest_position_ratio, b.torso_depth, m.shoulder_half_width, m.h_to_shoulder * render.chest_half_height_ratio);
    volume('abdomen', render.abdomen_position_ratio, b.torso_depth, b.waist_half_width, m.h_to_shoulder * render.abdomen_half_height_ratio);
    volume('pelvis', 0, b.pelvis_depth, m.hip_half_width + b.thigh_radius, b.thigh_radius);
    s.shoulders.set(shL, shR, b.upper_arm_radius);
    s.neck.set(neckBase, [headC[0] + b.head_depth * render.neck_head_depth_ratio, headC[1], headC[2] + (m.head_above_eye + b.head_below_eye) * render.neck_head_height_ratio], b.neck_radius);
    s.thighL.set(hipL, kneeL, b.thigh_radius); s.thighR.set(hipR, kneeR, b.thigh_radius);
    s.shankL.set(kneeL, aL, b.calf_radius); s.shankR.set(kneeR, aR, b.calf_radius);
    s.footL.set(aL, [aL[0] - b.foot_length, aL[1], aL[2] + render.foot_tip_height_left], b.foot_radius);
    s.footR.set(aR, [aR[0] - b.foot_length, aR[1], aR[2] + render.foot_tip_height_right], b.foot_radius);
    s.uArmL.set(shL, elbowL, b.upper_arm_radius); s.uArmR.set(shR, elbowR, b.upper_arm_radius);
    s.fArmL.set(elbowL, handL, b.forearm_radius); s.fArmR.set(elbowR, handR, b.forearm_radius);
    this.head.position.copy(V(headC));
    this.head.scale.set(b.head_depth / 2, b.head_half_width, (m.head_above_eye + b.head_below_eye) / 2);
    this.head.rotation.set(0, 0, 0);
    this.eyeMarker.position.copy(V(eye));
    this.eyellipse.position.copy(V(eye));
    for (const z of this.r46) z.position.x = eye[0] + z.userData.dx;

    // Sightlines and metrics
    const metrics = K.ergoMetrics(sp, a, manikin);
    const flags = K.ergoFlags(sp, metrics);
    for (const k of K.MIRRORS) {
      const c = this.mirrors[k].center;
      const r = K.mirrorReflectedDir(sp, a, manikin, k);
      this._setLine(k, [eye, c, K.add(c, K.scale(r, 3000))], !flags[`mirror_${k}_view`]);
    }
    const [top, bottom] = K.driverDisplayEdges(sp);
    this._setLine('cluster_top', [eye, top], !flags.cluster_visibility);
    this._setLine('cluster_bottom', [eye, bottom], !flags.cluster_visibility);
    return { metrics, flags, eye, H, wc };
  }

  /** Camera pose that looks through a mirror from the driver's eye (virtual eye behind the glass). */
  mirrorCamera(state, manikin, k) {
    const sp = this.spec, eye = K.eyePoint(sp, state, manikin);
    const c = this.mirrors[k].center, n = K.mirrorNormal(...K.mirrorAngles(state, k));
    const virt = K.sub(eye, K.scale(n, 2 * K.dot(K.sub(eye, c), n)));
    const dir = K.unit(K.sub(c, virt));
    const g = sp.mirrors[k].glass_size, dist = K.norm(K.sub(c, virt));
    return { pos: virt, target: K.add(c, K.scale(dir, 1000)), vfov: 2 * Math.atan(g.h / 2 / dist) * 180 / Math.PI, aspect: g.w / g.h };
  }
}
