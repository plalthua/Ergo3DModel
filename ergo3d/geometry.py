"""Kinematics and ergonomic metrics for the EX60 driver workplace.

All values are in the vehicle frame (mm, degrees): +X rearward from the front
axle, +Y to the right, +Z up from the ground. Keep this module in sync with
``viewer/kinematics.js`` which implements the same equations for the 3D view.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Tuple

Vec = Tuple[float, float, float]

MIRRORS = ("left", "right", "interior")


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Vec) -> Vec:
    n = norm(a)
    if n == 0:
        raise ValueError("zero-length vector")
    return scale(a, 1.0 / n)


def _p(d: dict) -> Vec:
    return (float(d["x"]), float(d["y"]), float(d["z"]))


def _v(d) -> float:
    return float(d["value"]) if isinstance(d, dict) else float(d)


@dataclass
class Adjustments:
    """Canonical adjustment state (one frame of the timeline)."""

    seat_x: float = 0.0
    seat_z: float = 0.0
    seat_back_angle: float = 25.0
    seat_cushion_tilt: float = 3.0
    steer_tilt: float = 0.0
    steer_telescope: float = 0.0
    steer_wheel_angle: float = 0.0
    mirror: Dict[str, Tuple[float, float]] = field(default_factory=dict)

    CHANNELS = (
        "seat_x", "seat_z", "seat_back_angle", "seat_cushion_tilt",
        "steer_tilt", "steer_telescope", "steer_wheel_angle",
        "mirror_left_yaw", "mirror_left_pitch",
        "mirror_right_yaw", "mirror_right_pitch",
        "mirror_interior_yaw", "mirror_interior_pitch",
    )

    @classmethod
    def design(cls, spec: dict) -> "Adjustments":
        s, st = spec["seat"], spec["steering"]
        mirrors = {
            m: (spec["mirrors"][m]["yaw_deg"]["design"], spec["mirrors"][m]["pitch_deg"]["design"])
            for m in MIRRORS
        }
        return cls(
            seat_x=s["fore_aft_mm"]["design"],
            seat_z=s["height_mm"]["design"],
            seat_back_angle=s["back_angle_deg"]["design"],
            seat_cushion_tilt=s["cushion_tilt_deg"]["design"],
            steer_tilt=st["tilt_deg"]["design"],
            steer_telescope=st["telescope_mm"]["design"],
            steer_wheel_angle=st["wheel_angle_deg"]["design"],
            mirror=mirrors,
        )

    @classmethod
    def from_channels(cls, spec: dict, values: Dict[str, float]) -> "Adjustments":
        """Build from canonical channel values; missing/NaN channels fall back to design."""
        adj = cls.design(spec)

        def ok(k):
            v = values.get(k)
            return v is not None and not (isinstance(v, float) and math.isnan(v))

        for k in ("seat_x", "seat_z", "seat_back_angle", "seat_cushion_tilt",
                  "steer_tilt", "steer_telescope", "steer_wheel_angle"):
            if ok(k):
                setattr(adj, k, float(values[k]))
        for m in MIRRORS:
            yaw, pitch = adj.mirror[m]
            if ok(f"mirror_{m}_yaw"):
                yaw = float(values[f"mirror_{m}_yaw"])
            if ok(f"mirror_{m}_pitch"):
                pitch = float(values[f"mirror_{m}_pitch"])
            adj.mirror[m] = (yaw, pitch)
        return adj


# ---------------------------------------------------------------- seat / body

def h_point(spec: dict, adj: Adjustments) -> Vec:
    s = spec["seat"]
    sg = _p(s["sgrp"])
    rail = math.radians(_v(s["rail_angle_deg"]))
    # Rails rise toward the front, so moving forward (-x) raises the seat.
    return (sg[0] + adj.seat_x, sg[1], sg[2] + adj.seat_z - adj.seat_x * math.tan(rail))


def torso_dir(back_angle_deg: float) -> Vec:
    """Unit vector from H-point up the torso line (reclines rearward)."""
    a = math.radians(back_angle_deg)
    return (math.sin(a), 0.0, math.cos(a))


def eye_point(spec: dict, adj: Adjustments, manikin: str) -> Vec:
    m = spec["manikins"][manikin]
    h = h_point(spec, adj)
    t = torso_dir(adj.seat_back_angle)
    e = add(h, scale(t, m["h_to_eye"]))
    return (e[0] - m["eye_forward"], e[1], e[2])


def shoulder_point(spec: dict, adj: Adjustments, manikin: str, side: int) -> Vec:
    """side = -1 for left shoulder, +1 for right."""
    m = spec["manikins"][manikin]
    h = h_point(spec, adj)
    s = add(h, scale(torso_dir(adj.seat_back_angle), m["h_to_shoulder"]))
    return (s[0], s[1] + side * m["shoulder_half_width"], s[2])


# ------------------------------------------------------------------- steering

def steering_axis(spec: dict, adj: Adjustments) -> Vec:
    """Unit column axis pointing from the column toward the driver (rearward/up)."""
    a = math.radians(_v(spec["steering"]["column_angle_deg"]) + adj.steer_tilt)
    return (math.cos(a), 0.0, math.sin(a))


def steering_pivot(spec: dict) -> Vec:
    st = spec["steering"]
    a0 = math.radians(_v(st["column_angle_deg"]))
    axis0 = (math.cos(a0), 0.0, math.sin(a0))
    return sub(_p(st["wheel_center_design"]), scale(axis0, _v(st["pivot_to_wheel_mm"])))


def wheel_center(spec: dict, adj: Adjustments) -> Vec:
    length = _v(spec["steering"]["pivot_to_wheel_mm"]) + adj.steer_telescope
    return add(steering_pivot(spec), scale(steering_axis(spec, adj), length))


def wheel_up(spec: dict, adj: Adjustments) -> Vec:
    """12 o'clock direction in the wheel plane (world up projected off the axis)."""
    ax = steering_axis(spec, adj)
    return unit(sub((0.0, 0.0, 1.0), scale(ax, ax[2])))


# -------------------------------------------------------------------- mirrors

def mirror_normal(yaw_deg: float, pitch_deg: float) -> Vec:
    """Glass normal; yaw=pitch=0 faces rearward (+X). +yaw turns toward +Y, +pitch tilts up."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    return (math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), math.sin(p))


def reflect(d: Vec, n: Vec) -> Vec:
    return sub(d, scale(n, 2 * dot(d, n)))


def mirror_view(spec: dict, adj: Adjustments, manikin: str, mirror: str) -> Tuple[float, float]:
    """Reflected sightline from the eye via the glass centre.

    Returns (outward_deg, elevation_deg): outward is the azimuth away from the
    vehicle centreline (positive = away from the car on that side), relative to
    straight rearward.
    """
    eye = eye_point(spec, adj, manikin)
    c = _p(spec["mirrors"][mirror]["glass_center"])
    yaw, pitch = adj.mirror[mirror]
    r = reflect(unit(sub(c, eye)), mirror_normal(yaw, pitch))
    az = math.degrees(math.atan2(r[1], r[0]))
    el = math.degrees(math.atan2(r[2], math.hypot(r[0], r[1])))
    if mirror == "left":
        az = -az
    return az, el


def recommended_mirror_angles(spec: dict, adj: Adjustments, manikin: str, mirror: str) -> Tuple[float, float]:
    """Yaw/pitch that aligns the reflected sightline with the spec target view."""
    mspec = spec["mirrors"][mirror]
    eye = eye_point(spec, adj, manikin)
    c = _p(mspec["glass_center"])
    tgt = mspec["target_view"]
    az = math.radians(tgt["outward_deg"]) * (-1 if mirror == "left" else 1)
    el = math.radians(tgt["elevation_deg"])
    r = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))
    d = unit(sub(c, eye))
    n = unit(sub(r, d))  # bisector: reflection maps d -> r
    yaw = math.degrees(math.atan2(n[1], n[0]))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, n[2]))))
    return yaw, pitch


# -------------------------------------------------------------------- metrics

def driver_display_edges(spec: dict) -> Tuple[Vec, Vec]:
    """(top, bottom) edge centres of the driver display, honouring its tilt."""
    d = spec["displays"]["driver"]
    c = _p(d["center"])
    t = math.radians(d.get("tilt_deg", 0.0))
    half = (-d["h"] / 2 * math.sin(t), 0.0, d["h"] / 2 * math.cos(t))  # screen leans back: top edge forward
    return add(c, half), sub(c, half)


def cluster_sightline_margin(spec: dict, adj: Adjustments, manikin: str) -> float:
    """How far (mm) the eye->driver-display sightlines stay inside the wheel opening.

    The sightlines to the display top and bottom edges are intersected with the
    wheel plane; each must pass below the rim's inner edge and above the hub.
    Returns the smallest margin; negative = rim or hub obstructs the display.
    """
    st = spec["steering"]
    r_inner = _v(st["rim_diameter"]) / 2 - _v(st["rim_thickness"]) / 2
    hub = _v(st.get("hub_radius", 85))
    eye = eye_point(spec, adj, manikin)
    wc, ax, up = wheel_center(spec, adj), steering_axis(spec, adj), wheel_up(spec, adj)
    margins = []
    for target in driver_display_edges(spec):
        d = sub(target, eye)
        denom = dot(d, ax)
        if abs(denom) < 1e-9:
            return float("nan")
        p = add(eye, scale(d, dot(sub(wc, eye), ax) / denom))
        s = dot(sub(p, wc), up)
        margins.append(min(r_inner - s, s - hub))
    return min(margins)


def headroom(spec: dict, adj: Adjustments, manikin: str) -> float:
    m = spec["manikins"][manikin]
    return _v(spec["vehicle"]["roof_inner_z"]) - (eye_point(spec, adj, manikin)[2] + m["head_above_eye"])


def clamp_report(spec: dict, adj: Adjustments) -> Dict[str, bool]:
    """True for each adjustment that lies outside its spec range."""
    s, st, ms = spec["seat"], spec["steering"], spec["mirrors"]
    checks = {
        "seat_x": (adj.seat_x, s["fore_aft_mm"]),
        "seat_z": (adj.seat_z, s["height_mm"]),
        "seat_back_angle": (adj.seat_back_angle, s["back_angle_deg"]),
        "seat_cushion_tilt": (adj.seat_cushion_tilt, s["cushion_tilt_deg"]),
        "steer_tilt": (adj.steer_tilt, st["tilt_deg"]),
        "steer_telescope": (adj.steer_telescope, st["telescope_mm"]),
    }
    for m in MIRRORS:
        checks[f"mirror_{m}_yaw"] = (adj.mirror[m][0], ms[m]["yaw_deg"])
        checks[f"mirror_{m}_pitch"] = (adj.mirror[m][1], ms[m]["pitch_deg"])
    return {k: not (r["min"] - 1e-9 <= v <= r["max"] + 1e-9) for k, (v, r) in checks.items()}


def ergo_metrics(spec: dict, adj: Adjustments, manikin: str) -> Dict[str, float]:
    h = h_point(spec, adj)
    wc = wheel_center(spec, adj)
    eye = eye_point(spec, adj, manikin)
    out: Dict[str, float] = {
        "h_x": h[0], "h_y": h[1], "h_z": h[2],
        "eye_x": eye[0], "eye_y": eye[1], "eye_z": eye[2],
        "wheel_x": wc[0], "wheel_y": wc[1], "wheel_z": wc[2],
        "hpoint_to_wheel_mm": norm(sub(wc, h)),
        "hpoint_to_wheel_dx_mm": h[0] - wc[0],
        "hpoint_to_wheel_dz_mm": wc[2] - h[2],
        "cluster_sightline_margin_mm": cluster_sightline_margin(spec, adj, manikin),
        "headroom_mm": headroom(spec, adj, manikin),
    }
    for m in MIRRORS:
        az, el = mirror_view(spec, adj, manikin, m)
        tgt = spec["mirrors"][m]["target_view"]
        out[f"mirror_{m}_view_outward_deg"] = az
        out[f"mirror_{m}_view_elev_deg"] = el
        out[f"mirror_{m}_view_error_deg"] = math.hypot(az - tgt["outward_deg"], el - tgt["elevation_deg"])
    return out


def ergo_flags(spec: dict, metrics: Dict[str, float]) -> Dict[str, bool]:
    """True = metric violates the configured ergo limit."""
    lim = spec["ergo_limits"]
    f = {
        "hpoint_to_wheel": not (lim["hpoint_to_wheel_mm"]["min"] <= metrics["hpoint_to_wheel_mm"] <= lim["hpoint_to_wheel_mm"]["max"]),
        "cluster_visibility": not (metrics["cluster_sightline_margin_mm"] >= lim["cluster_sightline_margin_mm"]["min"]),
        "headroom": metrics["headroom_mm"] < lim["headroom_mm"]["min"],
    }
    for m in MIRRORS:
        f[f"mirror_{m}_view"] = metrics[f"mirror_{m}_view_error_deg"] > lim["mirror_view_tolerance_deg"]["max"]
    return f
