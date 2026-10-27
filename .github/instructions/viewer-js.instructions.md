---
applyTo: "viewer/**/*.js"
---
- ES modules only; import Three.js as `three` / `three/addons/...` (import map in `viewer/index.html`, vendored r170). No CDNs.
- `kinematics.js` must mirror `ergo3d/geometry.py` function by function. Keep the names aligned and port any formula change to both files.
- Build geometry in the vehicle frame (mm, +X rear, +Y right, +Z up) inside `car.root`; use `car.toWorld()` for camera positions.
- Read every dimension from `spec` via `val()`. Do not hard-code dimensions.
- New scene parts go into a named layer (`this.layer(name)`) so they can be toggled and exported to GLB.
