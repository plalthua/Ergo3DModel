// Builds the parametric EX60 driver-workplace scene from data/ex60_spec.json.
// All geometry lives in `root`, expressed in the vehicle frame (mm, Z up);
// root converts to three.js world (metres, Y up).
import * as THREE from 'three';
import * as K from './kinematics.js';

const val = (d) => (typeof d === 'object' ? d.value : d);
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  bodyEdge: new THREE.LineBasicMaterial({ color: 0x5a7590, transparent: true, opacity: 0.55 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.9 }),
  rimMetal: new THREE.MeshStandardMaterial({ color: 0x8d949c, metalness: 0.7, roughness: 0.35 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8 }),
  dash: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.75, side: THREE.DoubleSide }),
  floor: new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 1 }),
  seat: new THREE.MeshStandardMaterial({ color: 0xc9b79c, roughness: 0.85 }),
  seatRail: new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.6, roughness: 0.4 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x5f656d, metalness: 0.5, roughness: 0.4 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0d1b2a, emissive: 0x1f6fb2, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe8ff, metalness: 1.0, roughness: 0.05, side: THREE.DoubleSide }),
  housing: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe0a97e, roughness: 0.7 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0x3d6fa8, roughness: 0.8 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff3366 }),
  eyellipse: new THREE.MeshBasicMaterial({ color: 0x00e0ff, wireframe: true, transparent: true, opacity: 0.35 }),
};

function box(w, d, h, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
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
    const veh = this.spec.vehicle, g = this.layer('body');
    const W = val(veh.width_excl_mirrors), pts = veh.side_profile_xz.points;
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W - 120, bevelEnabled: true, bevelSize: 60, bevelThickness: 60, bevelSegments: 3 });
    geo.rotateX(Math.PI / 2); // shape (x,z) plane; extrude along -Y
    geo.translate(0, (W - 120) / 2, 0);
    const shell = new THREE.Mesh(geo, MAT.body);
    shell.renderOrder = 10;
    g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), MAT.bodyEdge));

    const wb = val(veh.wheelbase), r = val(veh.wheel_diameter) / 2, tw = val(veh.tyre_width);
    const wheels = this.layer('wheels');
    for (const [x, track] of [[0, val(veh.track_front)], [wb, val(veh.track_rear)]]) {
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, tw, 40), MAT.tyre);
        t.position.set(x, (s * track) / 2, r);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.68, r * 0.68, tw + 4, 30), MAT.rimMetal);
        rim.position.copy(t.position);
        wheels.add(t, rim);
      }
    }
  }

  _buildInterior() {
    const sp = this.spec, g = this.layer('interior');
    const floorZ = val(sp.vehicle.floor_z);
    const floor = box(2600, 1600, 20, MAT.floor);
    floor.position.set(1500, 0, floorZ - 10);
    g.add(floor);

    const dash = box(330, 1620, 230, MAT.dash);
    dash.position.set(560, 0, 930);
    const dashTop = box(420, 1620, 40, MAT.dash);
    dashTop.position.set(580, 0, 1050);
    dashTop.rotation.y = THREE.MathUtils.degToRad(-6);
    const tunnel = box(700, 240, 260, MAT.trim);
    tunnel.position.set(1050, 0, floorZ + 130);
    g.add(dash, dashTop, tunnel);

    for (const key of ['center', 'driver']) {
      const d = sp.displays[key];
      const t = THREE.MathUtils.degToRad(d.tilt_deg || 0);
      const n = [Math.cos(t), 0, Math.sin(t)];
      const grp = new THREE.Group();
      grp.position.copy(V([d.center.x, d.center.y, d.center.z]));
      setBasis(grp, ...basisFromNormal(n));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), MAT.screen);
      const back = new THREE.Mesh(new THREE.BoxGeometry(d.w + 12, d.h + 12, 14), MAT.housing);
      back.position.z = -9;
      grp.add(scr, back);
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
    for (const dy of [-200, 200]) {
      const rail = box(s.fore_aft_mm.max - s.fore_aft_mm.min + 520, 30, 25, MAT.seatRail);
      const midX = s.sgrp.x + (s.fore_aft_mm.max + s.fore_aft_mm.min) / 2 - 80;
      rail.position.set(midX, s.sgrp.y + dy, val(this.spec.vehicle.floor_z) + 70);
      rail.rotation.y = THREE.MathUtils.degToRad(-val(s.rail_angle_deg));
      g.add(rail);
    }
    this.seat = new THREE.Group();
    this.cushion = new THREE.Group();
    const c = box(s.cushion.length, s.cushion.width, s.cushion.thickness, MAT.seat);
    c.position.set(-(s.cushion.length / 2 - 140), 0, -s.cushion.thickness / 2 - 25);
    this.cushion.add(c);
    this.back = new THREE.Group();
    this.back.position.set(120, 0, -40);
    const b = box(s.backrest.thickness, s.backrest.width, s.backrest.height, MAT.seat);
    b.position.set(s.backrest.thickness / 2, 0, s.backrest.height / 2);
    const hr = box(s.headrest.thickness, s.headrest.width, s.headrest.height, MAT.seat);
    hr.position.set(s.backrest.thickness / 2 - 10, 0, s.backrest.height + s.headrest.height / 2 + 30);
    this.back.add(b, hr);
    const pedestal = box(380, 420, 1, MAT.seatRail);
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
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(val(st.hub_radius ?? 85), 95, 70, 32), MAT.hub);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = -20;
    this.wheelSpin.add(rim, hub);
    for (const ang of [0, Math.PI, -Math.PI / 2]) {
      const spoke = box(R - 60, 34, 16, MAT.wheel);
      spoke.position.set(Math.cos(ang) * (R / 2 + 25), Math.sin(ang) * (R / 2 + 25), -12);
      spoke.rotation.z = ang;
      this.wheelSpin.add(spoke);
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
    this.mirrors = {};
    for (const k of K.MIRRORS) {
      const m = this.spec.mirrors[k], c = [m.glass_center.x, m.glass_center.y, m.glass_center.z];
      const grp = new THREE.Group();
      grp.position.copy(V(c));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(m.glass_size.w, m.glass_size.h), MAT.glass);
      const housing = box(m.glass_size.w + 24, m.glass_size.h + 24, k === 'interior' ? 30 : 70, MAT.housing);
      housing.position.z = k === 'interior' ? -17 : -38;
      grp.add(glass, housing);
      g.add(grp);
      // Fixed mount (arm to door / stem to roof)
      const mount = new Limb(k === 'interior' ? 9 : 22, MAT.housing, g);
      if (k === 'interior') mount.set(c, [c[0] + 30, c[1], val(this.spec.vehicle.roof_inner_z) + 20]);
      else mount.set(c, [c[0] + 110, Math.sign(c[1]) * (val(this.spec.vehicle.width_excl_mirrors) / 2 - 40), c[2] - 70]);
      this.mirrors[k] = { group: grp, center: c };
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
    this.pedestal.position.set(-120, 0, val(sp.vehicle.floor_z) + 85 - H[2] + 70);
    this.pedestal.scale.z = Math.max(1, H[2] - (val(sp.vehicle.floor_z) + 85) - 170);
    this.pedestal.position.z = -(this.pedestal.scale.z / 2) - 170;
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
