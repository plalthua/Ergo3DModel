"""Load real test-car logs, map signals to canonical channels and resample them
onto a common timeline that the 3D viewer can replay."""

from __future__ import annotations

import bisect
import csv
import json
import math
import os
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .geometry import Adjustments

TIMELINE_FORMAT = "ergo3d-timeline/1"
Series = Tuple[List[float], List[float]]


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- file readers

def _to_float(s: str) -> float:
    s = s.strip()
    if not s:
        return math.nan
    try:
        return float(s.replace(",", ".") if s.count(",") == 1 and "." not in s else s)
    except ValueError:
        return math.nan


def _parse_time(s: str) -> float:
    v = _to_float(s)
    if not math.isnan(v):
        return v
    try:
        return datetime.fromisoformat(s.strip().replace("Z", "+00:00")).timestamp()
    except ValueError:
        return math.nan


def read_csv(path: str) -> Dict[str, List[str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(8192)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(f, dialect))
    if not rows:
        raise ValueError(f"{path}: empty file")
    header = [h.strip() for h in rows[0]]
    cols: Dict[str, List[str]] = {h: [] for h in header}
    for r in rows[1:]:
        if not any(c.strip() for c in r):
            continue
        for i, h in enumerate(header):
            cols[h].append(r[i] if i < len(r) else "")
    return cols


def read_mdf(path: str, wanted: Iterable[str]) -> Dict[str, Series]:
    """Read selected channels from an ASAM MDF (.mf4/.mdf/.dat) file (needs `asammdf`)."""
    try:
        from asammdf import MDF  # type: ignore
        from asammdf.blocks.utils import MdfException
    except ImportError as e:  # pragma: no cover - optional dependency
        raise SystemExit("Reading MDF logs requires: pip install asammdf") from e
    out: Dict[str, Series] = {}
    try:
        with MDF(path) as mdf:
            available = {name.lower(): name for name in mdf.channels_db}
            for w in wanted:
                real = available.get(w.lower())
                if real:
                    sig = mdf.get(real)
                    out[w] = ([float(t) for t in sig.timestamps], [float(v) for v in sig.samples])
    except MdfException as exc:
        raise ValueError(f"MDF decoding failed: {exc}") from exc
    return out


# ------------------------------------------------------------- signal mapping

def _find(names: Sequence[str], aliases: Sequence[str]) -> Optional[str]:
    lower = {n.lower(): n for n in names}
    for a in aliases:
        if a.lower() in lower:
            return lower[a.lower()]
    return None


def _time_scale(unit: str, t: List[float]) -> float:
    if unit == "s":
        return 1.0
    if unit == "ms":
        return 1e-3
    if unit == "us":
        return 1e-6
    # auto: median step > 5 suggests milliseconds
    steps = sorted(b - a for a, b in zip(t, t[1:]) if b > a)
    return 1e-3 if steps and steps[len(steps) // 2] > 5 else 1.0


def extract_channels(path: str, mapping: dict, offset_s: float = 0.0) -> Dict[str, Series]:
    """Return canonical channel -> (time_s, value) for one log file."""
    chans = mapping["channels"]
    ext = os.path.splitext(path)[1].lower()
    out: Dict[str, Series] = {}
    if ext in (".mf4", ".mdf", ".dat"):
        aliases = {a: c for c, m in chans.items() for a in m["aliases"]}
        raw = read_mdf(path, aliases.keys())
        for a, (t, v) in raw.items():
            c = aliases[a]
            if c not in out:
                m = chans[c]
                out[c] = ([x + offset_s for x in t], [x * m.get("scale", 1) + m.get("offset", 0) for x in v])
        return out

    cols = read_csv(path)
    tcol = _find(list(cols), mapping["time"]["aliases"])
    if tcol is None:
        raise ValueError(f"{path}: no time column found (looked for {mapping['time']['aliases']})")
    t_raw = [_parse_time(s) for s in cols[tcol]]
    k = _time_scale(mapping["time"].get("unit", "auto"), [x for x in t_raw if not math.isnan(x)])
    t = [x * k + offset_s for x in t_raw]
    for c, m in chans.items():
        col = _find(list(cols), m["aliases"])
        if col is None or col == tcol:
            continue
        pairs = [(ti, _to_float(v)) for ti, v in zip(t, cols[col])]
        pairs = [(ti, v * m.get("scale", 1) + m.get("offset", 0)) for ti, v in pairs
                 if not math.isnan(ti) and not math.isnan(v)]
        if pairs:
            pairs.sort()
            out[c] = ([p[0] for p in pairs], [p[1] for p in pairs])
    return out


def merge(sources: Iterable[Dict[str, Series]]) -> Dict[str, Series]:
    merged: Dict[str, List[Tuple[float, float]]] = {}
    for src in sources:
        for c, (t, v) in src.items():
            merged.setdefault(c, []).extend(zip(t, v))
    out: Dict[str, Series] = {}
    for c, pairs in merged.items():
        pairs.sort()
        out[c] = ([p[0] for p in pairs], [p[1] for p in pairs])
    return out


# ------------------------------------------------------------ time alignment

def first_change_time(series: Series, threshold: float) -> Optional[float]:
    t, v = series
    if not v:
        return None
    v0 = v[0]
    for ti, vi in zip(t, v):
        if abs(vi - v0) > threshold:
            return ti
    return None


def interp(series: Series, tq: float) -> float:
    """Linear interpolation; holds edge values outside the logged span."""
    t, v = series
    if not t:
        return math.nan
    if tq <= t[0]:
        return v[0]
    if tq >= t[-1]:
        return v[-1]
    i = bisect.bisect_right(t, tq)
    t0, t1, v0, v1 = t[i - 1], t[i], v[i - 1], v[i]
    return v0 if t1 == t0 else v0 + (v1 - v0) * (tq - t0) / (t1 - t0)


def build_timeline(
    channels: Dict[str, Series],
    spec: dict,
    rate_hz: float = 10.0,
    t_start: Optional[float] = None,
    t_end: Optional[float] = None,
    align_event: Optional[str] = None,
    align_threshold: float = 1.0,
    sources: Sequence[str] = (),
) -> dict:
    if not channels:
        raise ValueError("No mapped channels found - check config/signal_mapping.json aliases")
    t0_all = min(s[0][0] for s in channels.values() if s[0])
    t1_all = max(s[0][-1] for s in channels.values() if s[0])
    zero = t0_all
    if align_event:
        if align_event not in channels:
            raise ValueError(f"align event channel '{align_event}' not present in logs")
        ev = first_change_time(channels[align_event], align_threshold)
        if ev is None:
            raise ValueError(f"channel '{align_event}' never changes by more than {align_threshold}")
        zero = ev
    a = t0_all if t_start is None else zero + t_start
    b = t1_all if t_end is None else zero + t_end
    n = max(1, int(math.floor((b - a) * rate_hz)) + 1)
    grid = [a + i / rate_hz for i in range(n)]

    out_ch: Dict[str, List[Optional[float]]] = {}
    for c in Adjustments.CHANNELS:
        if c in channels:
            out_ch[c] = [round(interp(channels[c], tq), 4) for tq in grid]

    design = Adjustments.design(spec)
    return {
        "format": TIMELINE_FORMAT,
        "vehicle": spec["meta"]["model"],
        "spec_version": spec["meta"]["spec_version"],
        "sources": [os.path.basename(s) for s in sources],
        "rate_hz": rate_hz,
        "time_zero_abs": zero,
        "align_event": align_event,
        "t": [round(tq - zero, 4) for tq in grid],
        "channels": out_ch,
        "missing_channels": [c for c in Adjustments.CHANNELS if c not in out_ch],
        "design": {
            "seat_x": design.seat_x, "seat_z": design.seat_z,
            "seat_back_angle": design.seat_back_angle, "seat_cushion_tilt": design.seat_cushion_tilt,
            "steer_tilt": design.steer_tilt, "steer_telescope": design.steer_telescope,
            "steer_wheel_angle": design.steer_wheel_angle,
            **{f"mirror_{m}_{k}": design.mirror[m][i] for m in design.mirror for i, k in enumerate(("yaw", "pitch"))},
        },
    }


def frame_values(timeline: dict, i: int) -> Dict[str, float]:
    return {c: v[i] for c, v in timeline["channels"].items()}
