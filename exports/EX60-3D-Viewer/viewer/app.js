import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as K from './kinematics.js';
import { Ex60Scene, studioEnvironment } from './model.js';

const SPEC_URL = '../data/ex60_spec.json';
const SAMPLE_URL = '../data/timelines/sample_timeline.json';
const $ = (id) => document.getElementById(id);

const spec = await (await fetch(SPEC_URL)).json();
const bodyPresets = structuredClone(spec.manikins);
const ranges = K.channelRanges(spec);
let state = K.designState(spec);
let manikin = 'p50_male';
let activeCamera = 'iso';
let timeline = null, tlTime = 0, playing = false, lastNow = performance.now();

// ------------------------------------------------------------------ scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.environment = studioEnvironment(renderer, spec);
scene.background = new THREE.Color(0x14171b);
scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x30343a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-3, 6, 4);
scene.add(sun);
const grid = new THREE.GridHelper(12, 48, 0x3a424c, 0x262b31);
grid.position.set(1.5, 0, 0);
scene.add(grid);

const car = new Ex60Scene(spec);
scene.add(car.root);
car.setInspectionTransparency($('inspectionTransparency').checked);
$('inspectionTransparency').onchange = () => car.setInspectionTransparency($('inspectionTransparency').checked);

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const mirrorCam = new THREE.PerspectiveCamera(20, 1.6, 0.05, 200);

const CAMS = {
  iso: () => {
    const length = spec.vehicle.length.value, height = spec.vehicle.height.value;
    const center = length / 2 - spec.vehicle.front_overhang.value;
    return [
      car.toWorld([center - length * 1.1, -length * 1.05, height * 1.9]),
      car.toWorld([center, 0, height / 2]),
    ];
  },
  side: () => [car.toWorld([1100, -4200, 1100]), car.toWorld([1100, -370, 1000])],
  top: () => [car.toWorld([1100, -369, 5200]), car.toWorld([1100, -370, 900])],
  front: () => [car.toWorld([-2800, -370, 1350]), car.toWorld([1000, -370, 1050])],
  eye: () => {
    const e = K.eyePoint(spec, state, manikin);
    return [car.toWorld(e), car.toWorld([e[0] - 1500, e[1], e[2] - 120])];
  },
};
function setCam(name) {
  activeCamera = name;
  const [p, t] = CAMS[name]();
  camera.position.copy(Array.isArray(p) ? new THREE.Vector3(...p) : p);
  controls.target.copy(t);
  controls.update();
}

// ---------------------------------------------------------------- sliders
const sliderEls = {};
for (const c of K.CHANNELS) {
  const r = ranges[c];
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const extra = c === 'steer_wheel_angle' ? 0 : Math.max(5, (r.max - r.min) * 0.15);
  wrap.innerHTML = `<div class="lbl"><span>${r.label}</span><span class="mono"></span></div>
    <input type="range" min="${r.min - extra}" max="${r.max + extra}" step="any" value="${r.design}">`;
  const input = wrap.querySelector('input');
  input.addEventListener('input', () => {
    state[c] = parseFloat(input.value);
    if (timeline && $('followLog').checked && c in timeline.channels) $('followLog').checked = false;
    refresh();
  });
  $('sliders').appendChild(wrap);
  sliderEls[c] = { wrap, input, out: wrap.querySelector('.mono') };
}
function syncSliders() {
  for (const c of K.CHANNELS) {
    const { wrap, input, out } = sliderEls[c], r = ranges[c], x = state[c];
    if (document.activeElement !== input) input.value = x;
    out.textContent = `${x.toFixed(1)} ${r.unit}`;
    out.classList.toggle('oor', x < r.min - 1e-6 || x > r.max + 1e-6);
    wrap.classList.toggle('logged', !!(timeline && c in timeline.channels));
  }
}

// --------------------------------------------------------------- manikins
const bodyControls = new Map();
const bodyCards = new Map();
const previewHeight = Math.max(...Object.values(bodyPresets).map((m) => m.head_above_eye + m.h_to_eye + m.thigh + m.shank));
function bodySilhouette(m) {
  const b = m.body;
  const hipY = m.head_above_eye + m.h_to_eye;
  const shoulderY = hipY - m.h_to_shoulder;
  const headR = (m.head_above_eye + b.head_below_eye) / 2;
  const torso = `M ${-m.shoulder_half_width} ${shoulderY}
    L ${m.shoulder_half_width} ${shoulderY}
    L ${b.waist_half_width} ${hipY - m.h_to_shoulder / 3}
    L ${m.hip_half_width + b.thigh_radius} ${hipY}
    L ${-m.hip_half_width - b.thigh_radius} ${hipY}
    L ${-b.waist_half_width} ${hipY - m.h_to_shoulder / 3} Z`;
  const limb = (x, y, dy, radius) => `<path d="M ${x} ${y} v ${dy}" stroke="currentColor" stroke-width="${2 * radius}" stroke-linecap="round"/>`;
  const arms = [-1, 1].map((s) => {
    const x = s * (m.shoulder_half_width + b.upper_arm_radius);
    return limb(x, shoulderY, m.upper_arm, b.upper_arm_radius) +
      limb(x, shoulderY + m.upper_arm, m.forearm_hand, b.forearm_radius);
  }).join('');
  const legs = [-1, 1].map((s) => limb(s * m.hip_half_width, hipY, m.thigh, b.thigh_radius) +
    limb(s * m.hip_half_width, hipY + m.thigh, m.shank, b.calf_radius)).join('');
  const halfWidth = Math.max(...Object.values(bodyPresets).map((p) => p.shoulder_half_width + 2 * p.body.upper_arm_radius));
  return `<svg viewBox="${-halfWidth} 0 ${halfWidth * 2} ${previewHeight}" aria-hidden="true" focusable="false">
    <g fill="currentColor">${legs}${arms}<path d="${torso}"/>
    ${limb(0, headR, shoulderY - headR, b.neck_radius)}
    <ellipse cx="0" cy="${headR}" rx="${b.head_half_width}" ry="${headR}"/></g></svg>`;
}

for (const [id, preset] of Object.entries(bodyPresets)) {
  $('manikin').add(new Option(preset.label, id, false, id === manikin));
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'driver-card';
  card.dataset.profile = id;
  card.setAttribute('aria-label', `${preset.label}. ${preset.description} Estimate.`);
  card.innerHTML = `${bodySilhouette(preset)}<span>${preset.label}</span><span class="category">${preset.category} · estimate</span>`;
  card.onclick = () => selectBody(id);
  bodyCards.set(id, card);
  $('driverCards').appendChild(card);
}
for (const control of spec.manikin_rendering.customization) {
  const label = document.createElement('label');
  label.className = 'slider';
  label.innerHTML = `<div class="lbl"><span>${control.label}</span><output class="mono">100%</output></div>
    <input id="body_${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="100">`;
  const input = label.querySelector('input');
  input.oninput = applyBodyDimensions;
  bodyControls.set(control.id, { input, output: label.querySelector('output') });
  $('bodySliders').appendChild(label);
}
function applyBodyDimensions() {
  const profile = structuredClone(bodyPresets[manikin]);
  let custom = false;
  const scaleDimensions = (obj, factor) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') obj[key] = value * factor;
      else if (value && typeof value === 'object') scaleDimensions(value, factor);
    }
  };
  for (const control of spec.manikin_rendering.customization) {
    const { input, output } = bodyControls.get(control.id);
    const percent = Number(input.value);
    if (!Number.isFinite(percent) || percent < control.min || percent > control.max) {
      throw new Error(`Invalid ${control.label}: ${input.value}`);
    }
    output.value = `${percent}%`;
    custom ||= percent !== 100;
    for (const path of control.paths) {
      if (path === '*') scaleDimensions(profile, percent / 100);
      else {
        const keys = path.split('.');
        const field = keys.pop();
        const parent = keys.reduce((obj, key) => obj[key], profile);
        parent[field] *= percent / 100;
      }
    }
  }
  if (custom) profile.label += ' (custom)';
  spec.manikins[manikin] = profile;
  updateBodySelection();
  refresh();
  if (activeCamera === 'eye') setCam('eye');
}
function updateBodySelection() {
  const profile = spec.manikins[manikin];
  $('manikin').value = manikin;
  $('selectedBody').textContent = profile.label;
  $('bodyInfo').textContent = `${profile.description} All dimensions are illustrative estimates. No collision or safety certification.`;
  for (const [id, card] of bodyCards) card.setAttribute('aria-pressed', String(id === manikin));
}
function selectBody(id) {
  spec.manikins[manikin] = structuredClone(bodyPresets[manikin]);
  manikin = id;
  for (const { input } of bodyControls.values()) input.value = 100;
  applyBodyDimensions();
}
$('manikin').onchange = (e) => selectBody(e.target.value);
$('resetBody').onclick = () => selectBody(manikin);
updateBodySelection();
$('autoMirrors').onclick = () => {
  for (const m of K.MIRRORS) {
    const [y, p] = K.recommendedMirrorAngles(spec, state, manikin, m);
    state[`mirror_${m}_yaw`] = y;
    state[`mirror_${m}_pitch`] = p;
  }
  $('followLog').checked = false;
  refresh();
};
$('resetDesign').onclick = () => { state = K.designState(spec); $('followLog').checked = false; refresh(); };

// --------------------------------------------------------- opening panels
const openingButtons = new Map();
for (const [id, opening] of Object.entries(car.openings)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.onclick = () => {
    car.setOpening(id, !opening.open);
    syncOpenings();
  };
  openingButtons.set(id, button);
  $('openingControls').appendChild(button);
}
function syncOpenings() {
  const openLabels = [];
  for (const [id, opening] of Object.entries(car.openings)) {
    const button = openingButtons.get(id);
    button.textContent = `${opening.open ? 'Close' : 'Open'} ${opening.label.toLowerCase()}`;
    button.setAttribute('aria-label', `${opening.label}: ${opening.open ? 'open; close' : 'closed; open'}`);
    if (opening.open) openLabels.push(opening.label);
  }
  $('openingStatus').textContent = openLabels.length ? `Open: ${openLabels.join(', ')}.` : 'All doors and tailgate closed.';
  car.layers.sightlines.visible = !car.hasOpenPanels && sightlinesToggle.checked;
  if (car.hasOpenPanels) $('pipLabels').replaceChildren();
  refresh();
}
for (const [id, open] of [['openAllDoors', true], ['closeAllDoors', false]]) {
  $(id).onclick = () => {
    for (const key of Object.keys(car.openings)) car.setOpening(key, open);
    syncOpenings();
  };
}

// ---------------------------------------------------------------- toggles
const layerLabels = {
  body: 'painted body',
  body_roof: 'roof (toggle for cutaway)',
  body_glazing: 'glazing',
  exterior_details: 'exterior trim and lamps',
  cabin_details: 'dashboard and console details',
  cabin_seating: 'passenger and rear bench (static visual estimates)',
  r46_zones: 'R46 ground zones',
};
let sightlinesToggle;
for (const name of Object.keys(car.layers)) {
  const l = document.createElement('label');
  l.className = 'chk';
  l.innerHTML = `<input type="checkbox" ${name === 'eyellipse' ? '' : 'checked'}> ${layerLabels[name] || name}`;
  const cb = l.querySelector('input');
  car.layers[name].visible = cb.checked;
  if (name === 'sightlines') sightlinesToggle = cb;
  cb.onchange = () => { car.layers[name].visible = cb.checked && (name !== 'sightlines' || !car.hasOpenPanels); };
  $('toggles').appendChild(l);
}
document.querySelectorAll('#cams button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));

// --------------------------------------------------------------- timeline
function loadTimeline(tl, name) {
  if (tl.format !== 'ergo3d-timeline/1') throw new Error('Not an ergo3d timeline (run: python -m ergo3d sync ...)');
  timeline = tl;
  tlTime = tl.t[0];
  $('scrub').min = tl.t[0];
  $('scrub').max = tl.t[tl.t.length - 1];
  $('scrub').disabled = $('play').disabled = false;
  $('followLog').checked = true;
  const miss = tl.missing_channels?.length ? ` · missing: ${tl.missing_channels.join(', ')}` : '';
  $('tlInfo').textContent = `${name}: ${tl.t.length} frames @ ${tl.rate_hz} Hz, ${Object.keys(tl.channels).length} channels${miss}`;
  applyTimeline();
}

function sampleTimeline(t) {
  const T = timeline.t;
  let lo = 0, hi = T.length - 1;
  if (t <= T[0]) hi = 0;
  else if (t >= T[hi]) lo = hi;
  else while (hi - lo > 1) { const mid = (lo + hi) >> 1; (T[mid] <= t ? (lo = mid) : (hi = mid)); }
  const u = hi === lo ? 0 : (t - T[lo]) / (T[hi] - T[lo]);
  const out = {};
  for (const [c, arr] of Object.entries(timeline.channels)) {
    const a = arr[lo], b = arr[hi];
    if (a != null && b != null) out[c] = a + (b - a) * u;
  }
  return out;
}

function applyTimeline() {
  if (!timeline) return;
  if ($('followLog').checked) Object.assign(state, sampleTimeline(tlTime));
  $('scrub').value = tlTime;
  $('tlTime').textContent = `${tlTime.toFixed(2)} s`;
  refresh();
}

$('loadSample').onclick = async () => {
  try {
    const r = await fetch(SAMPLE_URL);
    if (!r.ok) throw new Error(`${SAMPLE_URL}: HTTP ${r.status}. Run the "ergo3d: sync sample logs" task first.`);
    loadTimeline(await r.json(), 'sample_timeline.json');
  } catch (e) { alert(e.message); }
};
async function readFile(file) {
  try { loadTimeline(JSON.parse(await file.text()), file.name); } catch (e) { alert(e.message); }
}
$('timelineFile').onchange = (e) => e.target.files[0] && readFile(e.target.files[0]);
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); });
$('play').onclick = () => {
  playing = !playing;
  if (playing && tlTime >= timeline.t[timeline.t.length - 1]) tlTime = timeline.t[0];
  $('play').textContent = playing ? '❚❚ Pause' : '▶ Play';
  lastNow = performance.now();
};
$('scrub').oninput = (e) => { tlTime = parseFloat(e.target.value); applyTimeline(); };
$('followLog').onchange = applyTimeline;

// ----------------------------------------------------------------- export
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => (timeline ? `_t${tlTime.toFixed(1)}s` : '_manual');
$('exportGlb').onclick = () => new GLTFExporter().parse(car.root,
  (glb) => download(new Blob([glb], { type: 'model/gltf-binary' }), `ex60_ergo_${manikin}${stamp()}.glb`),
  (err) => alert(err), { binary: true });
$('exportPng').onclick = () => canvas.toBlob((b) => download(b, `ex60_ergo_${manikin}${stamp()}.png`));
$('exportPose').onclick = () => {
  const r = car.update(state, manikin);
  const pose = { vehicle: spec.meta.model, manikin, time_s: timeline ? tlTime : null, adjustments: state,
    visual_openings: Object.fromEntries(Object.entries(car.openings).map(([id, opening]) => [id, opening.open])),
    driver_profile: structuredClone(spec.manikins[manikin]),
    h_point: r.H, eye_point: r.eye, wheel_center: r.wc, metrics: r.metrics, flags: r.flags };
  download(new Blob([JSON.stringify(pose, null, 2)], { type: 'application/json' }), `ex60_pose_${manikin}${stamp()}.json`);
};

// ---------------------------------------------------------------- metrics
const METRIC_ROWS = [
  ['hpoint_to_wheel_mm', 'H-point → wheel centre', 'mm', 'hpoint_to_wheel'],
  ['hpoint_to_wheel_dx_mm', '  horizontal', 'mm'],
  ['hpoint_to_wheel_dz_mm', '  vertical', 'mm'],
  ['cluster_sightline_margin_mm', 'Cluster sightline margin', 'mm', 'cluster_visibility'],
  ['headroom_mm', 'Headroom', 'mm', 'headroom'],
  ['mirror_left_view_error_deg', 'Left mirror view error', '°', 'mirror_left_view'],
  ['mirror_right_view_error_deg', 'Right mirror view error', '°', 'mirror_right_view'],
  ['mirror_interior_view_error_deg', 'Interior mirror view error', '°', 'mirror_interior_view'],
];
function showMetrics(m, f) {
  const rows = METRIC_ROWS.map(([k, label, u, flag]) => {
    const cls = flag ? (f[flag] ? 'bad' : 'ok') : '';
    return `<tr class="${cls}"><td>${label}</td><td class="v">${Number.isFinite(m[k]) ? m[k].toFixed(1) : '–'} ${u}</td></tr>`;
  }).join('');
  $('metrics').innerHTML = `<div class="title">Ergo metrics · ${spec.manikins[manikin].label}</div>${car.hasOpenPanels ? '<div class="muted">Closed-vehicle metrics (visual panels are open).</div>' : ''}<table>${rows}</table>`;
}

function refresh() {
  const r = car.update(state, manikin);
  syncSliders();
  showMetrics(r.metrics, r.flags);
}

// provenance summary
{
  let est = 0, tot = 0;
  JSON.stringify(spec, (k, v) => { if (k === 'confidence') { tot++; if (String(v).includes('estimate')) est++; } return v; });
  $('provenance').innerHTML = `<br>${tot - est}/${tot} sourced values · ${est} estimates · ${spec.meta.sources.length} sources`;
}

// ------------------------------------------------------------- rendering
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function renderMirrorInsets(w, h) {
  const labels = [];
  const order = ['left', 'interior', 'right'];
  const pw = Math.min(260, w / 3.6), gap = 12;
  const x0 = (w - (pw * 3 + gap * 2)) / 2;
  const sightlinesVisible = car.layers.sightlines.visible;
  car.layers.sightlines.visible = false;
  const mirrorsVisible = car.layers.mirrors.visible;
  car.layers.mirrors.visible = false; // the virtual camera sits behind the glass
  order.forEach((k, i) => {
    const mc = car.mirrorCamera(state, manikin, k);
    const ph = pw / mc.aspect; // inset matches the glass aspect ratio
    const x = x0 + i * (pw + gap), y = 30;
    mirrorCam.position.copy(car.toWorld(mc.pos));
    mirrorCam.up.set(0, 1, 0);
    mirrorCam.lookAt(car.toWorld(mc.target));
    mirrorCam.fov = mc.vfov;
    mirrorCam.aspect = mc.aspect;
    const g = spec.mirrors[k].glass_center;
    const glassDist = K.norm(K.sub([g.x, g.y, g.z], mc.pos));
    mirrorCam.near = glassDist / 1000 + 0.02; // start just beyond the glass
    mirrorCam.updateProjectionMatrix();
    renderer.setViewport(x, y, pw, ph);
    renderer.setScissor(x, y, pw, ph);
    renderer.render(scene, mirrorCam);
    labels.push(`<div style="left:${x + 4}px;bottom:${y + ph - 18}px">${k} mirror</div>`);
  });
  car.layers.sightlines.visible = sightlinesVisible;
  car.layers.mirrors.visible = mirrorsVisible;
  $('pipLabels').innerHTML = labels.join('');
}

function frame(now) {
  const dt = (now - lastNow) / 1000;
  lastNow = now;
  if (playing && timeline) {
    tlTime += dt * parseFloat($('speed').value);
    const end = timeline.t[timeline.t.length - 1];
    if (tlTime >= end) { tlTime = end; playing = false; $('play').textContent = '▶ Play'; }
    applyTimeline();
  }
  resize();
  controls.update();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, camera);
  if ($('mirrorPip').checked && !car.hasOpenPanels) {
    renderer.setScissorTest(true);
    renderMirrorInsets(w, h);
    renderer.setScissorTest(false);
  } else $('pipLabels').innerHTML = '';
  requestAnimationFrame(frame);
}

// ----------------------------------------------------- compact (touch) layout
const compactQuery = window.matchMedia('(max-width: 900px), (max-height: 520px)');
function setDisclosure(button, target, open, showText, hideText) {
  target.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  button.textContent = open ? hideText : showText;
}
const setControls = (open) => setDisclosure($('toggleControls'), $('panel'), open, 'Show controls', 'Hide controls');
const setMetrics = (open) => setDisclosure($('toggleMetrics'), $('metrics'), open, 'Show metrics', 'Hide metrics');
$('toggleControls').onclick = () => setControls($('toggleControls').getAttribute('aria-expanded') !== 'true');
$('toggleMetrics').onclick = () => setMetrics($('toggleMetrics').getAttribute('aria-expanded') !== 'true');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && compactQuery.matches && $('panel').classList.contains('open')) {
    setControls(false);
    $('toggleControls').focus();
  }
});
function applyLayoutMode() {
  setControls(false);
  setMetrics(false);
  if (compactQuery.matches) {
    $('driverMenu').open = false;
    $('mirrorPip').checked = false;
  } else $('driverMenu').open = true;
}
compactQuery.addEventListener('change', applyLayoutMode);
applyLayoutMode();
syncOpenings();
setCam('iso');
requestAnimationFrame(frame);
window.ergo = { spec, car, K, camera, controls, setCam, get manikin() { return manikin; }, get state() { return state; }, get timeline() { return timeline; } };
