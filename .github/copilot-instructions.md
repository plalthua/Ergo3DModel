# EX60 Ergo Coordinator – project conventions

This workspace builds a parametric 3D ergonomics model of the Volvo EX60 driver workplace
(seat, steering wheel/column, exterior + interior mirrors) and replays real test-vehicle logs on it.

## Architecture
- `data/ex60_spec.json` – **single source of truth** for all geometry, adjustment ranges, manikins,
  ergo limits and provenance. Never hard-code geometry in code.
- `ergo3d/` – zero-dependency Python 3.9+ package: `geometry.py` (kinematics + metrics),
  `log_sync.py` (CSV/MF4 → canonical channels → resampled timeline), `report.py`, `cli.py`.
- `viewer/` – Three.js (vendored, offline) browser viewer. `kinematics.js` is a line-for-line port of
  `geometry.py`; `model.js` builds the scene; `app.js` is the UI.
- `config/signal_mapping.json` – maps real ECU/DBC signal names to canonical channels (aliases, scale, offset).

## Rules
- Vehicle frame, millimetres: origin = front axle centre at ground, **+X rearward, +Y right, +Z up**,
  LHD driver at Y = −370. Angles in degrees. Mirror yaw = pitch = 0 means the glass normal faces +X.
- Sourced spec values are `{ "value": …, "confidence": "official|press|proxy|estimate", "source": "<id>" }`
  where `<id>` refers to an entry in `meta.sources` (title, url, retrieved). When you change a value,
  update `confidence` and `source`. Never upgrade confidence without a citable source. Record
  unknowns in `meta.data_gaps`.
- `geometry.py` and `viewer/kinematics.js` must stay numerically identical. If you change one, change
  the other and check that the viewer metrics panel equals `python -m ergo3d design`.
- Canonical channels are listed in `Adjustments.CHANNELS`; the timeline format is `ergo3d-timeline/1`.
  Missing channels fall back to design values – never invent log data.
- Run `python -m unittest discover -s tests -t .` after any Python/spec change.
- Do not commit proprietary test-vehicle logs or Volvo-confidential CAD; `data/logs/` is git-ignored.
