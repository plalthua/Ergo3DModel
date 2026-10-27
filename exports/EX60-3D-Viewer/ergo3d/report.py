"""Per-frame ergonomic evaluation of a synced timeline."""

from __future__ import annotations

import csv
import math
from typing import Dict, List

from .geometry import Adjustments, clamp_report, ergo_flags, ergo_metrics, recommended_mirror_angles, MIRRORS
from .log_sync import frame_values


def evaluate(spec: dict, timeline: dict, manikin: str) -> List[Dict[str, float]]:
    rows = []
    for i, t in enumerate(timeline["t"]):
        adj = Adjustments.from_channels(spec, frame_values(timeline, i))
        m = ergo_metrics(spec, adj, manikin)
        flags = ergo_flags(spec, m)
        oor = clamp_report(spec, adj)
        row = {"t": t, **{k: round(v, 2) for k, v in m.items()}}
        row.update({f"flag_{k}": int(v) for k, v in flags.items()})
        row["out_of_range"] = ";".join(k for k, v in oor.items() if v)
        rows.append(row)
    return rows


def summarize(spec: dict, timeline: dict, rows: List[Dict[str, float]], manikin: str) -> dict:
    flag_keys = [k for k in rows[0] if k.startswith("flag_")] if rows else []
    dt = 1.0 / timeline["rate_hz"]
    last = Adjustments.from_channels(spec, frame_values(timeline, len(timeline["t"]) - 1))
    mid = len(timeline["t"]) // 2
    mid_adj = Adjustments.from_channels(spec, frame_values(timeline, mid))
    num = lambda k: [r[k] for r in rows if isinstance(r[k], (int, float)) and not math.isnan(r[k])]
    return {
        "manikin": manikin,
        "frames": len(rows),
        "duration_s": round(len(rows) * dt, 2),
        "missing_channels": timeline.get("missing_channels", []),
        "violation_seconds": {k[5:]: round(sum(r[k] for r in rows) * dt, 2) for k in flag_keys},
        "ranges": {
            k: {"min": round(min(num(k)), 1), "max": round(max(num(k)), 1)}
            for k in ("hpoint_to_wheel_mm", "cluster_sightline_margin_mm", "headroom_mm")
            if num(k)
        },
        "frames_with_out_of_range_adjustment": sum(1 for r in rows if r["out_of_range"]),
        "recommended_mirror_angles_at_mid_drive": {
            m: dict(zip(("yaw", "pitch"), (round(a, 2) for a in recommended_mirror_angles(spec, mid_adj, manikin, m))))
            for m in MIRRORS
        },
        "final_mirror_angles": {m: {"yaw": last.mirror[m][0], "pitch": last.mirror[m][1]} for m in MIRRORS},
    }


def write_csv(path: str, rows: List[Dict[str, float]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
