// Kinematics + ergo metrics for the EX60 driver workplace.
// Mirrors ergo3d/geometry.py — keep both implementations in sync.
// Vehicle frame (mm, deg): +X rearward from front axle, +Y right, +Z up from ground.

export const MIRRORS = ['left', 'right', 'interior'];

export const CHANNELS = [
  'seat_x', 'seat_z', 'seat_back_angle', 'seat_cushion_tilt',
  'steer_tilt', 'steer_telescope', 'steer_wheel_angle',
  'mirror_left_yaw', 'mirror_left_pitch',
  'mirror_right_yaw', 'mirror_right_pitch',
  'mirror_interior_yaw', 'mirror_interior_pitch',
];

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const v = (x, y, z) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.sqrt(dot(a, a));
export const unit = (a) => scale(a, 1 / norm(a));
const P = (d) => [d.x, d.y, d.z];
const val = (d) => (typeof d === 'object' ? d.value : d);

/** Range descriptor for every canonical channel (used for sliders and clamping). */
export function channelRanges(spec) {
  const s = spec.seat, st = spec.steering, m = spec.mirrors;
  const r = {
    seat_x: { ...s.fore_aft_mm, unit: 'mm', label: 'Seat Length' },
    seat_z: { ...s.height_mm, unit: 'mm', label: 'Seat height' },
    seat_back_angle: { ...s.back_angle_deg, unit: '°', label: 'Backrest angle' },
    seat_cushion_tilt: { ...s.cushion_tilt_deg, unit: '°', label: 'Cushion tilt' },
    steer_tilt: { ...st.tilt_deg, unit: '°', label: 'Steering tilt' },
    steer_telescope: { ...st.telescope_mm, unit: 'mm', label: 'Steering telescope' },
    steer_wheel_angle: { ...st.wheel_angle_deg, unit: '°', label: 'Steering wheel angle' },
  };
  for (const k of MIRRORS) {
    r[`mirror_${k}_yaw`] = { ...m[k].yaw_deg, unit: '°', label: `${k} mirror yaw` };
    r[`mirror_${k}_pitch`] = { ...m[k].pitch_deg, unit: '°', label: `${k} mirror pitch` };
  }
  return r;
}

export function designState(spec) {
  const r = channelRanges(spec);
  return Object.fromEntries(CHANNELS.map((c) => [c, r[c].design]));
}

// ------------------------------------------------------------- seat / body
export function hPoint(spec, a) {
  const s = spec.seat, sg = P(s.sgrp);
  const rail = rad(val(s.rail_angle_deg));
  return [sg[0] + a.seat_x, sg[1], sg[2] + a.seat_z - a.seat_x * Math.tan(rail)];
}

export const torsoDir = (backDeg) => [Math.sin(rad(backDeg)), 0, Math.cos(rad(backDeg))];

export function eyePoint(spec, a, manikin) {
  const m = spec.manikins[manikin];
  const e = add(hPoint(spec, a), scale(torsoDir(a.seat_back_angle), m.h_to_eye));
  return [e[0] - m.eye_forward, e[1], e[2]];
}

export function shoulderPoint(spec, a, manikin, side) {
  const m = spec.manikins[manikin];
  const s = add(hPoint(spec, a), scale(torsoDir(a.seat_back_angle), m.h_to_shoulder));
  return [s[0], s[1] + side * m.shoulder_half_width, s[2]];
}

// ---------------------------------------------------------------- steering
export function steeringAxis(spec, a) {
  const t = rad(val(spec.steering.column_angle_deg) + a.steer_tilt);
  return [Math.cos(t), 0, Math.sin(t)];
}

export function steeringPivot(spec) {
  const st = spec.steering, a0 = rad(val(st.column_angle_deg));
  return sub(P(st.wheel_center_design), scale([Math.cos(a0), 0, Math.sin(a0)], val(st.pivot_to_wheel_mm)));
}

export function wheelCenter(spec, a) {
  const L = val(spec.steering.pivot_to_wheel_mm) + a.steer_telescope;
  return add(steeringPivot(spec), scale(steeringAxis(spec, a), L));
}

export function wheelUp(spec, a) {
  const ax = steeringAxis(spec, a);
  return unit(sub([0, 0, 1], scale(ax, ax[2])));
}

// ----------------------------------------------------------------- mirrors
export function mirrorNormal(yawDeg, pitchDeg) {
  const y = rad(yawDeg), p = rad(pitchDeg);
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
}

export const reflect = (d, n) => sub(d, scale(n, 2 * dot(d, n)));

export function mirrorAngles(a, mirror) {
  return [a[`mirror_${mirror}_yaw`], a[`mirror_${mirror}_pitch`]];
}

export function mirrorReflectedDir(spec, a, manikin, mirror) {
  const eye = eyePoint(spec, a, manikin);
  const c = P(spec.mirrors[mirror].glass_center);
  return reflect(unit(sub(c, eye)), mirrorNormal(...mirrorAngles(a, mirror)));
}

export function mirrorView(spec, a, manikin, mirror) {
  const r = mirrorReflectedDir(spec, a, manikin, mirror);
  let az = deg(Math.atan2(r[1], r[0]));
  const el = deg(Math.atan2(r[2], Math.hypot(r[0], r[1])));
  if (mirror === 'left') az = -az;
  return [az, el];
}

export function recommendedMirrorAngles(spec, a, manikin, mirror) {
  const ms = spec.mirrors[mirror];
  const eye = eyePoint(spec, a, manikin);
  const c = P(ms.glass_center);
  const az = rad(ms.target_view.outward_deg) * (mirror === 'left' ? -1 : 1);
  const el = rad(ms.target_view.elevation_deg);
  const r = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const n = unit(sub(r, unit(sub(c, eye))));
  return [deg(Math.atan2(n[1], n[0])), deg(Math.asin(Math.max(-1, Math.min(1, n[2]))))];
}

// ----------------------------------------------------------------- metrics
export function driverDisplayEdges(spec) {
  const d = spec.displays.driver, c = P(d.center), t = rad(d.tilt_deg || 0);
  const half = [(-d.h / 2) * Math.sin(t), 0, (d.h / 2) * Math.cos(t)];
  return [add(c, half), sub(c, half)];
}

export function clusterSightlineMargin(spec, a, manikin) {
  const st = spec.steering;
  const rInner = val(st.rim_diameter) / 2 - val(st.rim_thickness) / 2;
  const hub = val(st.hub_radius ?? 85);
  const eye = eyePoint(spec, a, manikin);
  const wc = wheelCenter(spec, a), ax = steeringAxis(spec, a), up = wheelUp(spec, a);
  let m = Infinity;
  for (const target of driverDisplayEdges(spec)) {
    const d = sub(target, eye);
    const den = dot(d, ax);
    if (Math.abs(den) < 1e-9) return NaN;
    const p = add(eye, scale(d, dot(sub(wc, eye), ax) / den));
    const s = dot(sub(p, wc), up);
    m = Math.min(m, rInner - s, s - hub);
  }
  return m;
}

export function headroom(spec, a, manikin) {
  return val(spec.vehicle.roof_inner_z) - (eyePoint(spec, a, manikin)[2] + spec.manikins[manikin].head_above_eye);
}

export function ergoMetrics(spec, a, manikin) {
  const h = hPoint(spec, a), wc = wheelCenter(spec, a);
  const out = {
    hpoint_to_wheel_mm: norm(sub(wc, h)),
    hpoint_to_wheel_dx_mm: h[0] - wc[0],
    hpoint_to_wheel_dz_mm: wc[2] - h[2],
    cluster_sightline_margin_mm: clusterSightlineMargin(spec, a, manikin),
    headroom_mm: headroom(spec, a, manikin),
  };
  for (const m of MIRRORS) {
    const [az, el] = mirrorView(spec, a, manikin, m);
    const t = spec.mirrors[m].target_view;
    out[`mirror_${m}_view_outward_deg`] = az;
    out[`mirror_${m}_view_elev_deg`] = el;
    out[`mirror_${m}_view_error_deg`] = Math.hypot(az - t.outward_deg, el - t.elevation_deg);
  }
  return out;
}

export function ergoFlags(spec, m) {
  const L = spec.ergo_limits;
  const f = {
    hpoint_to_wheel: !(m.hpoint_to_wheel_mm >= L.hpoint_to_wheel_mm.min && m.hpoint_to_wheel_mm <= L.hpoint_to_wheel_mm.max),
    cluster_visibility: !(m.cluster_sightline_margin_mm >= L.cluster_sightline_margin_mm.min),
    headroom: m.headroom_mm < L.headroom_mm.min,
  };
  for (const k of MIRRORS) f[`mirror_${k}_view`] = m[`mirror_${k}_view_error_deg`] > L.mirror_view_tolerance_deg.max;
  return f;
}

/** Two-bone IK in 3D. Returns the joint position (knee/elbow). */
export function twoBoneIK(root, target, l1, l2, hint) {
  let d = sub(target, root);
  const dist = Math.min(Math.max(norm(d), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  d = unit(d);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const perp = unit(sub(hint, scale(d, dot(hint, d))));
  return add(add(root, scale(d, a)), scale(perp, h));
}

/** Point reached by a chain clamped to its length (for the end effector). */
export function reachable(root, target, maxLen) {
  const d = sub(target, root), n = norm(d);
  return n <= maxLen ? target : add(root, scale(d, maxLen / n));
}
