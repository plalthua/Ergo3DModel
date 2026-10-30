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

## Local supplied GLB
The source viewer now defaults to the complete supplied car in
`CarImage/VCC200_V436_PAC3D_251230_V0_11.glb`, replacing all generated car visuals.
**View > Vehicle geometry** switches back to the articulated parametric estimates;
`?model=parametric` also selects them on startup. **Open local GLB** replaces the
visual with a file selected on this PC. Inspection transparency works on either model.

The supplied GLB is **static**: seat, steering, mirrors and door pivots have not been
validated or connected to replay. Replay still computes the original parametric
metrics, not measurements from the imported vehicle. Numeric results are unchanged
for every body profile. Manikin/sightline overlays start hidden in GLB mode and,
if explicitly enabled, remain uncalibrated estimates. Units and axle/ground alignment
are estimates requiring CAD or physical verification; the file does not establish
EX60 identity or official ergonomic dimensions.

The private GLB stays local and is excluded from all HTML/ZIP sharing packages.
Portable viewers default to the parametric model; authorized users can select their
own local GLB without uploading it. GLB redistribution/export and unbound door/mirror
controls are disabled while the imported vehicle is displayed.

## OneDrive sharing package
**Simplest option: share just [EX60-3D-Viewer.html](exports/EX60-3D-Viewer.html)** (~1.5 MB).
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
- **Doors and tailgate**: individual open/close buttons for all four doors and the tailgate/trunk,
  plus **Open all** and **Close all**. Windows, door handles and front-door mirrors move with
  their panels; the rear bumper stays fixed. Hinges, panel boundaries and opening angles are
  illustrative **estimates**, not Volvo measurements or a clearance/safety analysis.
  Each door now has a single curved glazing seal on the correct side and a finished panel
  edge, rather than detached tubular frames/seam outlines. The tailgate is a central hatch
  with side rails around its rear glass; the rear corner panels and shoulder strips remain
  fixed instead of lifting a full-width duplicate rear shell. The opening angle and all new
  edge/seal dimensions remain estimates guided visually by local side/rear gallery images.
  An estimated fixed cargo floor and wheelhouse lining close the view through to the ground
  and tires when the hatch is raised; they are visual context, not measured cargo capacity.
  Opening states are independent of log replay and design-position adjustments. Mirror insets
  and sightlines are hidden while any panel is open; ergonomic metrics still describe the
  closed vehicle. Screenshots capture the current panel pose, and Pose JSON records
  `visual_openings` separately from canonical logged adjustments.
  To run the browser integration check, serve the project and open
  [tests/openings.html](tests/openings.html). It checks all five buttons, hinge transforms,
  closing recovery, moving accessories, fixed-panel apertures and unchanged metrics.
  Add `?target=standalone`, `?target=desktop` or `?target=teams` to check a rebuilt
  package, and `&mobile` for the compact controls layout.
- Sliders for every adjustment, a manikin selector, **Auto-adjust mirrors** (solves yaw/pitch for the target view) and **Design position**.
- **Refined visual context**: painted exterior panels with wheel-arch openings, separate glazing, roof, lamps and trim; layered dashboard fascia, recessed vents, a raised circular speaker, generic screens, center console and steering-wheel controls. All four side-door skins and their windows are **60% transparent (40% opacity)** by default, both open and closed. Enable **Cabin inspection transparency** under **View** to also make the roof/pillars translucent (16% opacity); side-door transparency stays at 60% in either mode. These are visualization settings, not real panel properties. Hood, fenders and tailgate remain opaque. Use the **roof (toggle for cutaway)** layer to expose the cabin from above; glazing, cabin details and exterior trim can also be toggled independently.
- **Seat and mirror detail**: rounded, tapered cushion/backrest, layered bolsters, shoulder panels,
  concealed headrest support, upholstery seams and lower shell; sculpted exterior mirror caps,
  shaped glass/rims, black mounting arms/trim and a rounded interior rearview housing. All detail
  is static geometry in the existing seat/mirror layers and follows the original adjustment/log
  pivots. H-point, mirror centers, normal axes and metric glass width/height are unchanged.
  Geometry/material parameters live in `visual_reconstruction.seat_detail` and `mirror_detail`.
  This is an original parametric interpretation, not downloaded textures or exact photo/CAD reconstruction.
  Local gallery images `overview-exterior-gallery-08-1.webp`, `-09-1.webp` and `-01-1.webp`
  guide the seat, exterior cap/arm and rearview shapes respectively.
  [Car and Driver's EX60 reveal](https://www.caranddriver.com/news/a70059359/2027-volvo-ex60-revealed/)
  was retrieved on 2026-10-27 and confirms optional headrest speakers; those optional components are
  **not** depicted. The [Ars Technica EX60 article](https://arstechnica.com/cars/2026/01/heres-volvos-new-ex60-60000-electric-midsize-suv/)
  was also retrieved for general vehicle context, not seat/mirror dimensions.
  The official Volvo UK EX60 page returned HTTP 403. No measured upholstery, glass contour,
  mirror curvature or hidden mount data was available; all new visual dimensions remain **estimates**.
- **Steering detail**: rounded-square tubular rim with flatter top/bottom, warm light leather
  on the inner/front surfaces and dark outer/rear leather, original procedural bump/roughness
  grain, physical cross-stitches, tapered cushion/back shell, narrow satin accents, blank circular
  badge, two short spokes with raised control islands/rockers/buttons and open lower trim.
  All detail follows the existing tilt, telescope and logged wheel spin, without per-frame rebuilding.
  Parameters and estimate provenance are in `visual_reconstruction.dashboard.steering_trim`.
  Local `dashboard1.png`, `interior-gallery-6.webp` and gallery `01` cockpit guide the visual
  interpretation; no photo texture, trademark logo or copied control artwork is embedded.
  The visual contour preserves the original rim's cardinal grip centers and XY envelope; the
  ergonomic model still uses its unchanged circular grip assumptions, radius, center and normal.
- **Visuals are estimates, not package data.** The reconstruction uses local CarImage references and cited press imagery only as visual guides; it is not photorealistic or dimensionally verified. The screens use generic procedural graphics, and the added visual geometry does not change ergonomic hardpoints, adjustment ranges or calculated metrics. See `visual_reconstruction` and `meta.data_gaps` in [the spec](data/ex60_spec.json) for provenance and unknowns. No third-party photos are embedded.
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

## Visual model validation
Open `http://127.0.0.1:8060/tests/visual_model.html` while the local server is running
to render the exterior and check finite mesh geometry and metrics for all nine profiles.
It also checks the rounded seat/mirror parts, seat adjustment parenting, unchanged mirror glass
pivots and normals at zero and adjustment endpoints. Add `?details=1` for a cabin/seat view.
Add `?dashboard=1` for the dashboard cutaway, or `?screenshot=1` to hide the test output.
This is a rendering smoke test, not a dimensional-accuracy or photorealism certification.

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

### Manual NUC MDF download and automatic replay conversion

1. Start the local viewer with `python -m ergo3d serve --open` from the project root.
   The optional `asammdf` dependency in `requirements.txt` must be installed in that Python environment.
2. Click **NucLogger export**. It opens <https://log-analyzer.nuc.volvocars.net/> in a new tab
   and starts a local download session. If the popup is blocked, use **Open Log Analyzer in a new tab**.
   After signing in, **Try embedded view** optionally loads the Analyzer inside the dialog.
   Frame policies, SSO or third-party cookie restrictions may prevent embedding; use the new tab
   instead. The viewer neither bypasses those policies nor reads the external iframe.
3. Sign in normally, select the authorized VIN/time/signals on the website, and save
   completed `.mf4` files directly into **`data\logs\` relative to the project root**.
   Use Save as or move files from Downloads; the viewer cannot set browser download preferences.
   In Log Analyzer: open a VIN/time window or upload your own raw captures, verify
   the SDB/Interfaces, plot the ergonomic signals, then **Export data...**.
   Select plotted signals and a continuous time range, choose **MDF4 (.mf4)**,
   click **Export**, and download the result. Select actual physical positions/angles,
   not state names or command signals.
4. Verify actual channel aliases and scale/offset in [config/signal_mapping.json](config/signal_mapping.json),
   then tick the mapping-confirmation box. The supplied names/calibration are placeholders.
   MDF samples are already decoded physical values: normally use scale 1 and offset 0 unless
   a verified model-coordinate conversion is needed. Do not apply DBC scaling twice.
   Use the actual channel names in the exported MDF. Analyzer numeric signals keep
   their signal names; some value-table signals also have a numeric `__physical`
   channel. An ambiguous same-named channel needs a narrower export or explicit
   channel selection before import; do not silently select a different bus.
5. Return to the viewer and close the **local NucLogger export dialog** (Close or Escape).
   New/changed top-level `.mf4`/`.mdf` files from this session are converted automatically.
   Closing the external website tab alone cannot reliably trigger local conversion.

Replay JSONs stay private under `data\logs\ergo-replay\<session>\`. The first
converted recording opens automatically; use the recording selector for others.
An error is displayed for unfinished downloads, missing mappings, corrupt files
or unavailable dependencies; **Retry MF4 conversion** retries without resaving
successful files. Existing unchanged files and subfolders are not imported.

Files are never merged or aligned implicitly. Each replay uses the common time
coverage of its mapped channels at 10 Hz; repeated/reset timestamps, non-finite
samples and empty overlaps are rejected. [Log Analyzer](https://nuc.volvocars.net/tools/log-analyzer.html)
exports every decoded sample in the selected range, not its plot-reduced points.
Ergo uses linear interpolation at 10 Hz for physical position/angle playback.
The importer records the largest sample spacing per channel; this is not proof
of capture coverage. Export a known continuous test interval,
not unrelated measurement files. At most 64 changed files and one million output
frames per conversion batch are accepted.
Missing channels use design defaults (not measured coverage). Conversion does
not verify VIN, decoder revision, calibration or cross-device clock alignment.
Keep real logs and replay JSONs out of HTML/ZIP exports and commits.

This workflow requires the loopback `ergo3d serve` API. Offline HTML, static servers
and Teams/SharePoint pages can open the Analyzer website but cannot convert local files.
No website credentials are transferred to the local viewer, and no Azure acquisition is used.

The Analyzer's raw captures, indexes and temporary exports live on its server,
not in a discoverable local PC folder. Opening or embedding it does not transfer
those files. Ergo cannot read its browser memory, cookies, server cache or download
history. Use the explicit MF4 download above; local raw PCAP/PCAPNG/BLF/ASC files
must be uploaded and decoded in the Analyzer first. MF4s from the separate MDF
Export website remain supported too, but that website is no longer the default.

### NUC Drive / share-drive export by VIN and time period

The intended flow is bounded
local download -> verified CAN/Ethernet time alignment -> independent signal series
-> calibrated ergonomic timeline. Final signal selection can be tuned later.

The local Python server now uses a **share-drive copy connector**, with no Azure
Blob SDK or Azure CLI dependency. See [share setup and recording index](docs/share-drive-connector.md).
It reads a UNC/mapped drive using the server process's Windows permissions, or a
local folder of files downloaded manually through NUC Drive. The internal website
remains inaccessible here; no NUC web-download API or actual share root is verified.
Clock alignment and decoding are not implemented by the copy connector.

In the viewer's **NucLogger export** dialog, expand **Optional indexed share-drive copy**
for a VIN and UTC start/end times. With `serve --nuc-config data\logs\share-drive.json`,
**Review request** selects indexed chunks and checks source files, then
**Download approved files** copies only that preview to a private local session.
An **Open NUC Drive** link opens the site for normal browser sign-in/manual download;
it does not automate the website or transfer browser credentials.
Without that configuration, review is local only and downloading remains disabled.
Form details are not saved to browser storage; approved downloads persist VIN/time
and source provenance in the local manifest.
Close the dialog with **Close** or **Escape**. It is also included in the offline
HTML and desktop/Teams export packages.

## AI agents (VS Code Copilot Chat → agent picker)
Select **Master Agent** for all project requests. It is the only user-facing project agent:
it handles questions and approvals, invokes specialists internally when needed, and returns
one consolidated response. The seven specialists are hidden from the agent picker but remain
available as subagents. Built-in VS Code agents are unaffected.

| Agent | Job | Models (first available is used) |
|---|---|---|
| **Master Agent** | Single interaction point; coordinates the internal specialists below | Claude Opus 4.5 → Claude Sonnet 4.5 → GPT-5 |
| **EX60 Researcher** | Finds Volvo, press and standards data and writes it into the spec with confidence and source | Gemini 2.5 Pro → GPT-5 → Claude Sonnet 4.5 |
| **Ergo 3D Modeler** | Geometry, kinematics and viewer; keeps the Python and JS versions in sync | Claude Sonnet 4.5 → GPT-5-Codex → GPT-5 |
| **NUC Authentication** | API/SSO and Windows share identity diagnosis; separates service permissions and keeps private auth research out of shared artifacts | Session default |
| **NUC Log Export** | Share-drive-first acquisition using Windows permissions or manual NUC Drive download handoff; VIN/time index validation, clock evidence and separate native-rate series | Session default |
| **Test Log Sync** | Maps real CAN/ECU signals and builds timelines and reports | GPT-5 → Claude Sonnet 4.5 → GPT-5 mini |
| **Ergo Reviewer** | Read-only check against SAE J4004/J941/J1050/J1100 and UN ECE R46 | Claude Opus 4.5 → o3 → GPT-5 |
| **Teams Web Exporter** | PC/mobile responsive exports, Teams sharing diagnostics, package validation and access-controlled deployment handoff | Session default |

Prompts: `/import-test-log`, `/export-vin-replay`, `/update-ex60-spec`, `/ergo-review`,
`/export-teams-viewer` all run through Master Agent.
If the picker still shows the previous coordinator or specialists, run **Developer: Reload Window**.
Change the `model:` lists in
`.github/agents/*.agent.md` to match the models enabled in your Copilot plan.

## Two-reference cabin remodel (2026-10-28)

The supplied frontal dashboard and top-cabin images inform an **uncalibrated visual
reconstruction**, not factory CAD. Neither image is embedded or redistributed.
New parameters live in `data/ex60_spec.json`, with estimate provenance and separate
source IDs for the two images:

- Slim DIM above the wheel on a raised forward shelf; broad swept fabric fascia,
  grey wood, central raised speaker, original landscape display graphics.
- A 32 × 24 shared-vertex windscreen grid with 64 mm central bow and matching curved
  edge bands; boundaries retain the cowl, A-pillar and roof junctions.
- Original procedural woven/perforated inserts, light upholstery, fine plastic and
  paint grain, subtle grey wood, non-metallic windscreen glass with estimated IOR.
- Symmetric passenger front seat and a continuous three-place rear bench with
  supported headrests, belt buckles and a stowed center armrest. These are static
  visual estimates, not passenger CAN channels or validated passenger H-points.
- Driver adjustment/replay frames, Seat Length, steering and mirror refinements are
  retained. Doors are 40% opaque (60% transparent) and roof panels 16% opaque for inspection.

The source and packaged Python/JS now share `above_rim` and legacy `through_wheel`
DIM clearance routes (unknown routes fail explicitly). DIM center is intentionally
`[680, -370, 1230]` mm with 10° tilt. This supersedes both the legacy source
`[640, -370, 1075]` / 20° and earlier export-only `[440, -370, 1165]` / 10°.
The new position is inside the bowed glazing envelope; photo perspective is **not**
a calibrated placement constraint.

Design DIM margins below are signed vertical wheel-plane clearances in mm, not
full-screen occlusion, reach, road visibility or regulatory certification:

| Profile | Legacy source | Remodel | Delta |
|---|---:|---:|---:|
| p5_female | -1.481 | -8.229 | -6.748 |
| p50_male | 13.460 | 8.369 | -5.092 |
| p95_male | -4.544 | 21.068 | 25.612 |
| adult_medium_female | 9.929 | 0.318 | -9.611 |
| adult_slim | 13.460 | 8.369 | -5.092 |
| adult_broad | 13.460 | 8.369 | -5.092 |
| adult_large_body | 13.460 | 8.369 | -5.092 |
| teen_small | -9.836 | -14.277 | -4.442 |
| teen_tall | 12.041 | 2.041 | -10.001 |

Negative margins still flag the small adult and small teenage illustrative profiles.
Every other design metric is unchanged for all nine profiles; measurements are
needed before making visibility or occupant-fit decisions.

Validation:
```powershell
python -m unittest discover -s tests -t .
python -m ergo3d design
python tools\validate_reference_remodel.py --out reports\reference-remodel
powershell -File tools\refresh_exports.ps1
```
The browser check uses a fresh bounded localhost server and isolated disposable
project-local Chrome profile, renders exterior/dashboard/top/seats/upholstery views,
checks curved glass/trim topology, mirror normals and driver versus static seating,
and compares Python/JS metrics in both DIM modes. An optional pre-existing
`baseline-metrics.json` in the output folder enables all-nine metric delta checks.
Build staging stays inside the project and is removed after bundling.
`refresh_exports.ps1` copies the Python package, spec, browser files, mapping and
README into the desktop folder, verifies source parity, then rebuilds standalone
HTML, local Teams package, ZIPs and SHA256 manifests. It does not publish remotely.

## Data provenance – read this
Volvo's websites block automated retrieval, and Volvo has published **no EX60 interior package
dimensions** (seat travel, SgRP, column geometry or mirror positions).
- Exterior dimensions (4803 × 1899 × 1635 mm, wheelbase 2970 mm) and the equipment facts are sourced.
- Most interior geometry has `confidence: "estimate"` and was derived from package rules and SPA2/SPA3 sibling proxies.
- The viewer footer shows the count of sourced vs. estimated values.
- Replace the estimates with CAD or H-point machine measurements before drawing conclusions. The open items are listed in `meta.data_gaps`.
