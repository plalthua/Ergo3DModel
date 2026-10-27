"""Generate synthetic EX60 test-drive logs that mimic two ECUs with different
time bases and raw encodings (exercises scaling, offsets and merging)."""

from __future__ import annotations

import csv
import math
import os


def _smooth(t: float, t0: float, t1: float, a: float, b: float) -> float:
    if t <= t0:
        return a
    if t >= t1:
        return b
    u = (t - t0) / (t1 - t0)
    return a + (b - a) * (3 * u * u - 2 * u * u * u)


def generate(out_dir: str, duration_s: float = 60.0) -> list:
    os.makedirs(out_dir, exist_ok=True)
    seat_path = os.path.join(out_dir, "ex60_seat_ecu.csv")
    body_path = os.path.join(out_dir, "ex60_body_ecu.csv")

    # Seat ECU: 20 Hz, seconds, raw 0.1 mm counts from the end stops.
    with open(seat_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "DrvSeatLgtPosnRaw", "DrvSeatHeiPosnRaw", "DrvSeatBackAgDeg", "DrvSeatCushTiltDeg"])
        n = int(duration_s * 20)
        for i in range(n + 1):
            t = i / 20
            # Easy-entry rear-most -> memory recall -> small driver fine tune -> easy-exit
            x = _smooth(t, 2, 6, 100, -20)
            x = _smooth(t, 9, 10.5, x, -35) if t >= 9 else x
            x = _smooth(t, 52, 56, x, 100) if t >= 52 else x
            z = _smooth(t, 3, 6, 0, 15)
            back = _smooth(t, 4, 7, 22, 24.5)
            tilt = _smooth(t, 5, 7, 2, 4)
            w.writerow([f"{t:.3f}", round((x + 140) * 10), round((z + 25) * 10), f"{back:.2f}", f"{tilt:.2f}"])

    # Body/steering ECU: 50 Hz, milliseconds since logger start (offset 0.25 s).
    with open(body_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["time_ms", "StrColTiltDeg", "StrColTelescMm", "SteerWhlAgSafe",
                    "MirrLeHorzPosnDeg", "MirrLeVertPosnDeg", "MirrRiHorzPosnDeg",
                    "MirrRiVertPosnDeg", "IntrMirrHorzDeg", "IntrMirrVertDeg"])
        n = int(duration_s * 50)
        for i in range(n + 1):
            t = i / 50
            tilt = _smooth(t, 3, 6, 3.5, 1.0)
            tele = _smooth(t, 3, 6, -30, 10)
            tilt = _smooth(t, 52, 55, tilt, 3.5) if t >= 52 else tilt
            tele = _smooth(t, 52, 55, tele, -30) if t >= 52 else tele
            drive = 0.0
            if 15 <= t <= 50:
                drive = 35 * math.sin(2 * math.pi * (t - 15) / 8) + (90 * math.sin(math.pi * (t - 30) / 6) if 30 <= t <= 36 else 0)
            ml_y = _smooth(t, 10, 12, 25, 22.0)
            ml_p = _smooth(t, 10, 12, 8, 5.5)
            mr_y = _smooth(t, 12, 14, -36, -32.0)
            mr_p = _smooth(t, 12, 14, 6, 3.0)
            mi_y = _smooth(t, 8, 11, -26, -33.5)
            mi_p = _smooth(t, 8, 11, -5, -8.5)
            w.writerow([round(t * 1000 + 250), f"{tilt:.2f}", f"{tele:.1f}", f"{drive:.1f}",
                        f"{ml_y:.2f}", f"{ml_p:.2f}", f"{mr_y:.2f}", f"{mr_p:.2f}", f"{mi_y:.2f}", f"{mi_p:.2f}"])
    return [seat_path, body_path]
