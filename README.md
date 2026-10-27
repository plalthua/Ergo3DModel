# EX60 Ergo Coordinator – 3D model

A parametric 3D ergonomics model of the **Volvo EX60** driver workplace: **driver seat, steering
wheel/column, exterior and interior mirrors**. It includes nine illustrative driver body profiles
(adult and teenage examples), sightlines, cluster visibility, headroom and UN ECE R46 mirror fields of view. Positions
can be **replayed from real test-vehicle logs** (CSV or MF4).

![layers](https://img.shields.io/badge/three.js-r170%20vendored-blue) ![python](https://img.shields.io/badge/python-3.9%2B%20stdlib-green)

## Quick start
```powershell
python -m ergo3d design                       # metrics at design position for all manikins
python -m ergo3d sample                       # synthetic 2-ECU test logs
python -m ergo3d sync data/sample_logs/ex60_seat_ecu.csv data/sample_logs/ex60_body_ecu.csv@-0.25 -o data/timelines/sample_timeline.json
python -m ergo3d report data/timelines/sample_timeline.json --manikin p50_male
python -m ergo3d serve --open                 # http://127.0.0.1:8060/viewer/index.html
python -m unittest discover -s tests -t .
```
The same commands are available as VS Code tasks (**Terminal → Run Task → ergo3d: …**) and as launch configs.
Open [EX60-Ergo3DModel.code-workspace](EX60-Ergo3DModel.code-workspace) in VS Code to load the project and its existing workspace settings, tasks, and launch configurations.

## Open in a local web browser
From this project folder, run:
```powershell
python -m ergo3d serve --port 8060 --open
```
Open **http://127.0.0.1:8060/viewer/index.html** in any modern WebGL-capable browser
(Edge, Chrome, Firefox, or another compatible browser) on this PC. You can use multiple
browsers at the same time; VS Code's integrated browser is not required.

Keep the server running while viewing the model. To stop a server started in your terminal,
press **Ctrl+C** there. Restart the command after a reboot. If port 8060 is already in use,
use `--port 8061` and change the URL accordingly.

The server listens only on `127.0.0.1`, so it is not exposed to other PCs on the network.
No internet connection is required for the viewer. Do not open the HTML directly using
`file://`: browser module and data loading require the local HTTP server.

## OneDrive sharing package
**Simplest option: share just [EX60-3D-Viewer.html](exports/EX60-3D-Viewer.html)** (~1.2 MB).
It embeds the viewer, styles, Three.js and its license, nine body profiles, geometry spec and
synthetic demo timeline. Double-click it or use **Open with** a modern WebGL-enabled browser
from a local, network-shared or OneDrive-synced folder. No Python, server, VS Code, installation
or internet connection is needed. All existing viewer controls and exports remain available.
Make the file available offline if OneDrive has left it as a cloud-only placeholder.

OneDrive/SharePoint web previews may block JavaScript: recipients must **download the HTML
and open it in their browser**, rather than relying on the sharing-link preview.
The embedded data is a snapshot; no private logs or reports are bundled.
The HTML uses a single classic JavaScript bundle: no import maps, JavaScript module loading,
`data:` module URLs or runtime asset fetches are required. It still requires JavaScript and WebGL.
If scripts are blocked, the page displays download/open instructions rather than relying on a
permanent loading message. This cannot override Teams/SharePoint preview restrictions.
After replacing an older export on a web host, use **Ctrl+F5** or a versioned website URL
to avoid loading the old cached page. Re-upload the rebuilt file/ZIP rather than reusing an old copy.

To rebuild it after changing the viewer/spec/demo, install the build-only bundler once, then run:
```powershell
npm --prefix tools install
python tools\build_shareable_html.py
```
Alternatively, provide a native esbuild executable on PATH or via `ESBUILD_BINARY_PATH`.
The npm dependency is only for building; recipients need no Node.js or npm.
The HTML build tests also require esbuild.
The builder uses only explicitly listed viewer assets and the synthetic demo; it does not scan
real-log or report folders. Body customizations still remain in the current tab unless exported.

**Optional server-based package:**
The [exports/EX60-3D-Viewer](exports/EX60-3D-Viewer/) folder is a self-contained snapshot
of the viewer, spec, Python CLI and synthetic demo timeline. A matching
[EX60-3D-Viewer.zip](exports/EX60-3D-Viewer.zip) is ready to upload to OneDrive.
Real logs, private reports, CAD and editor/agent settings are excluded.

The folder and ZIP also include the single HTML file above. To use the original server-based
viewer instead, recipients download and extract the ZIP, install Python 3.9+ if needed, then double-click
`StartViewer.cmd`. It opens their default browser at
**http://127.0.0.1:8065/viewer/index.html**; keep the launcher running while viewing.
See [READ-ME-FIRST.txt](exports/EX60-3D-Viewer/READ-ME-FIRST.txt) for details.
OneDrive shares the files; it does not host the interactive website. This package is a snapshot,
not automatically updated when the project changes. No upload or share-link creation is performed.

## Teams channel: click-to-view web link
The [EX60-Teams-Web.zip](exports/EX60-Teams-Web.zip) package is an IT deployment handoff.
It contains a self-contained `index.html`, a deployment guide, channel-post template and
checksums. You can upload the ZIP to a Teams channel's Files/Shared folder for distribution.

**Uploading to Teams Files alone does not host an interactive website.** For browser-only access
by link, IT must publish the HTML on an approved HTTPS website with appropriate access controls,
then share that actual website URL in the channel (or a Website tab, if supported).
Teams channel membership does not automatically grant or restrict access to the separate host.
See [DEPLOY-AND-SHARE.txt](exports/EX60-Teams-Web/DEPLOY-AND-SHARE.txt) for requirements and
the download-and-open fallback. This is not a Teams app or SharePoint Framework package.
### Mobile and phone browsers
The viewer is responsive (width <= 900 px or height <= 520 px): a native **Show/Hide controls** button
(`aria-expanded`) opens the controls drawer, **Show/Hide metrics** and the driver profile menu are collapsed
by default, and touch gestures (one finger orbit, two fingers pinch/pan) drive OrbitControls. The device
pixel ratio is capped at 2.

- **Tested:** Chrome with touch/mobile emulation at 390×844, 360×740, 844×390 and desktop 1440×1000.
  **Not tested** on physical iOS/Safari or Android devices; no real-device support is promised.
- Teams/SharePoint previews (desktop and mobile apps) cannot run the viewer's JavaScript. A PC download of the HTML is
  the local fallback. **For mobile, use an IT-managed authenticated HTTPS host.**
- Channel membership does not authorize access to that host. IT must configure Entra ID/SharePoint authorization
  that matches the exact channel membership, including private/shared channels and guest members. The page has no
  client-side authorization. No upload or deployment is performed by this repository.
No external upload, hosting deployment or live web link has been created.

## Viewer
- Sliders for every adjustment, a manikin selector, **Auto-adjust mirrors** (solves yaw/pitch for the target view) and **Design position**.
- **Driver body profiles**: select a silhouette card in the menu over the 3D scene, or use the
  Occupant dropdown. Nine illustrative profiles include small/medium/tall adults, medium adult
  female, slim, broad-shouldered and larger-body adults, plus smaller and taller teenage figures.
  Head size, torso depth, shoulder/hip spacing and limb thickness change along with the skeleton.
  Collapse the menu by clicking its heading to uncover the scene.
- Under **Adjust body dimensions**, change overall body size, shoulder breadth, hip spacing,
  torso depth or limb girth relative to the selected preset. **Reset body dimensions** restores
  the preset; **Design position** resets the vehicle adjustments only. Changing bodies preserves
  seat/steering/mirror adjustments and log replay. Metrics and mirror auto-adjust use the current
  body's eye point; body girth changes the mesh but is not a collision/clearance assessment.
  Pose JSON includes the exact body dimensions; GLB embeds the profile on the manikin group.
  Custom dimensions remain in this browser tab and are not written back to the spec or Python
  reports. For reproducible Python reports, add measured dimensions as a spec profile.
- **Confidence: estimate.** All profiles (including the original percentile-labelled figures)
  are illustrative engineering assumptions, not validated population anthropometry.
  Teenage examples are not age percentiles and imply neither legal driving eligibility nor
  a safety/compliance result. These options are representative examples, not every possible body.
- **Test-log replay**: *Load sample*, open a timeline file, or drag and drop one. Play, scrub and change speed. *Drive model from log* applies the logged positions.
- Views: Iso, Side, Top, Front, **Driver eye**. Live **mirror insets** render from the reflected eye point; the image is not mirror-flipped. Layer toggles include the R46 ground zones.
- Metrics panel: H-point→wheel distance, cluster sightline margin, headroom and mirror view error. Values are coloured against `ergo_limits`.
- Export a **GLB** of the posed model (metres, Y-up), a PNG screenshot or the pose as JSON.

## Architecture
| Path | Purpose |
|---|---|
| [data/ex60_spec.json](data/ex60_spec.json) | Single source of truth: geometry, adjustment ranges, manikins, ergo limits, sources, data gaps |
| [ergo3d/geometry.py](ergo3d/geometry.py) | Kinematics and metrics (H-point, eye point, column, mirror reflection, cluster margin) |
| [ergo3d/log_sync.py](ergo3d/log_sync.py) | CSV/MF4 → canonical channels → merged and resampled `ergo3d-timeline/1` |
| [ergo3d/report.py](ergo3d/report.py) | Per-frame metrics CSV and a summary JSON (violation seconds, ranges, recommended mirror angles) |
| [config/signal_mapping.json](config/signal_mapping.json) | Real signal names → canonical channels (aliases, scale, offset) |
| [viewer/](viewer/) | Three.js viewer; [kinematics.js](viewer/kinematics.js) is a port of `geometry.py` |
| [.github/agents/](.github/agents/) | AI agents (see below) |

**Coordinate frame** (mm, degrees): origin at the front-axle centre at ground level, **+X rearward, +Y right, +Z up**. The LHD driver sits at Y = −370.
Mirror yaw = pitch = 0 means the glass normal faces +X (rearward).

## Syncing real test data
1. Copy the logs to `data/logs/` (this folder is git-ignored).
2. Add your signal names to `aliases` in [config/signal_mapping.json](config/signal_mapping.json), and set
   `scale` and `offset` so the values come out in spec units:
   - `seat_x`: mm, positive = rearward of design.
   - `seat_z`: mm, positive = up.
   - Angles: degrees.

   The time column is auto-detected (s or ms, ISO timestamps or decimal commas).
3. Sync the logs:
   `python -m ergo3d sync data/logs/seat.csv data/logs/body.mf4@-0.12 --align-event seat_x -o data/timelines/run42.json`
   - `file@seconds` shifts that file's clock.
   - `--align-event` sets t = 0 at the first change of the given channel.
   - MF4 files need `pip install -r requirements.txt` (asammdf).
4. Run the report with `python -m ergo3d report data/timelines/run42.json --manikin p95_male`, then open the timeline in the viewer.

Channels missing from the logs fall back to design values and are listed in `missing_channels`.

## AI agents (VS Code Copilot Chat → agent picker)
Select **Master Agent** for all project requests. It is the only user-facing project agent:
it handles questions and approvals, invokes specialists internally when needed, and returns
one consolidated response. The five specialists are hidden from the agent picker but remain
available as subagents. Built-in VS Code agents are unaffected.

| Agent | Job | Models (first available is used) |
|---|---|---|
| **Master Agent** | Single interaction point; coordinates the internal specialists below | Claude Opus 4.5 → Claude Sonnet 4.5 → GPT-5 |
| **EX60 Researcher** | Finds Volvo, press and standards data and writes it into the spec with confidence and source | Gemini 2.5 Pro → GPT-5 → Claude Sonnet 4.5 |
| **Ergo 3D Modeler** | Geometry, kinematics and viewer; keeps the Python and JS versions in sync | Claude Sonnet 4.5 → GPT-5-Codex → GPT-5 |
| **Test Log Sync** | Maps real CAN/ECU signals and builds timelines and reports | GPT-5 → Claude Sonnet 4.5 → GPT-5 mini |
| **Ergo Reviewer** | Read-only check against SAE J4004/J941/J1050/J1100 and UN ECE R46 | Claude Opus 4.5 → o3 → GPT-5 |
| **Teams Web Exporter** | PC/mobile responsive exports, Teams sharing diagnostics, package validation and access-controlled deployment handoff | Session default |

Prompts: `/import-test-log`, `/update-ex60-spec`, `/ergo-review`, `/export-teams-viewer` all run through Master Agent.
If the picker still shows the previous coordinator or specialists, run **Developer: Reload Window**.
Change the `model:` lists in
`.github/agents/*.agent.md` to match the models enabled in your Copilot plan.

## Data provenance – read this
Volvo's websites block automated retrieval, and Volvo has published **no EX60 interior package
dimensions** (seat travel, SgRP, column geometry or mirror positions).
- Exterior dimensions (4803 × 1899 × 1635 mm, wheelbase 2970 mm) and the equipment facts are sourced.
- Most interior geometry has `confidence: "estimate"` and was derived from package rules and SPA2/SPA3 sibling proxies.
- The viewer footer shows the count of sourced vs. estimated values.
- Replace the estimates with CAD or H-point machine measurements before drawing conclusions. The open items are listed in `meta.data_gaps`.
