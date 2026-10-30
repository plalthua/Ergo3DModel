"""Convert manually downloaded MDF files without merging independent recordings."""

import json
import math
import os
import threading
import time
import uuid
from pathlib import Path

from .geometry import Adjustments
from .log_sync import build_timeline, extract_channels, load_json
from .nuc_export import ConnectorError, file_version


class MdfImporter:
    def __init__(self, root, spec=None):
        self.root = Path(root)
        self.logs = self.root / "data" / "logs"
        self.spec = Path(spec) if spec else self.root / "data" / "ex60_spec.json"
        self.mapping = self.root / "config" / "signal_mapping.json"
        self.sessions = {}
        self.lock = threading.Lock()

    def _files(self):
        self.logs.mkdir(parents=True, exist_ok=True)
        files = {}
        for path in self.logs.iterdir():
            if path.suffix.lower() not in (".mf4", ".mdf"):
                continue
            info = path.lstat()
            if path.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ConnectorError(f"{path.name}: linked MDF files are not supported.")
            if path.is_file():
                files[path.name] = file_version(info)
        return files

    def begin(self):
        with self.lock:
            now = time.monotonic()
            self.sessions = {key: value for key, value in self.sessions.items()
                             if now - value["created"] < 14400}
            if len(self.sessions) >= 16:
                raise ConnectorError("Too many MDF export sessions. Restart the local server.")
            token = uuid.uuid4().hex
            self.sessions[token] = {"created": now, "files": self._files()}
            return {"session_id": token, "folder": "data\\logs"}

    def convert(self, token, mapping_verified):
        if mapping_verified is not True:
            raise ConnectorError("Confirm the real signal mapping, units and calibration before conversion.")
        if not isinstance(token, str):
            raise ConnectorError("Open NucLogger export first.")
        if not self.lock.acquire(blocking=False):
            raise ConnectorError("An MDF conversion is already running. Wait before retrying.")
        try:
            session = self.sessions.get(token)
            if session is None or time.monotonic() - session["created"] >= 14400:
                raise ConnectorError("MDF export session expired. Reopen NucLogger export before downloading.")
            for path in self.logs.iterdir():
                if path.name.lower().endswith((".crdownload", ".part", ".partial", ".tmp")):
                    raise ConnectorError("A download is unfinished in data\\logs. Wait for it to finish, then retry.")
            files = self._files()
            changed = {name: version for name, version in files.items()
                       if session["files"].get(name) != version}
            if not changed:
                raise ConnectorError("No new or changed MF4/MDF files in data\\logs. Save the download there, then retry.")
            if len(changed) > 64:
                raise ConnectorError("More than 64 changed MDF files. Use a smaller download batch.")
            spec, mapping = load_json(str(self.spec)), load_json(str(self.mapping))
            if not isinstance(mapping, dict) or not isinstance(mapping.get("channels"), dict):
                raise ConnectorError("config\\signal_mapping.json must contain a channels object.")
            for name, config in mapping["channels"].items():
                if name not in Adjustments.CHANNELS or not isinstance(config, dict):
                    raise ConnectorError(f"Unknown or invalid ergonomic channel in mapping: {name}")
                aliases = config.get("aliases")
                if not isinstance(aliases, list) or not aliases or not all(isinstance(a, str) and a for a in aliases):
                    raise ConnectorError(f"{name}: mapping requires nonempty signal aliases.")
                for field in ("scale", "offset"):
                    value = config.get(field, 1 if field == "scale" else 0)
                    if type(value) not in (int, float) or not math.isfinite(value):
                        raise ConnectorError(f"{name}: {field} must be a finite number.")
            results, errors = [], []
            total_frames = 0
            for name, version in sorted(changed.items()):
                try:
                    path = self.logs / name
                    if path.stat().st_size == 0:
                        raise ValueError("File is empty; finish downloading before conversion.")
                    channels = extract_channels(str(path), mapping)
                    if not channels:
                        raise ValueError("No mapped ergonomic channels. Update config\\signal_mapping.json with real names.")
                    gaps = {}
                    for channel, (timestamps, values) in channels.items():
                        if not timestamps or not all(math.isfinite(x) for sequence in (timestamps, values)
                                                     for x in sequence):
                            raise ValueError(f"{channel}: empty or non-finite samples.")
                        steps = [b - a for a, b in zip(timestamps, timestamps[1:])]
                        if any(step <= 0 for step in steps):
                            raise ValueError(f"{channel}: timestamps repeat or reset. Export a continuous segment.")
                        gaps[channel] = max(steps, default=0)
                    start = max(series[0][0] for series in channels.values())
                    end = min(series[0][-1] for series in channels.values())
                    zero = min(series[0][0] for series in channels.values())
                    if end <= start:
                        raise ValueError("Mapped channels have no shared continuous time range.")
                    frames = int(math.floor((end - start) * 10)) + 1
                    if frames + total_frames > 1_000_000:
                        raise ValueError("Download batch exceeds one million replay frames. Export a shorter window.")
                    timeline = build_timeline(channels, spec, 10, start - zero, end - zero,
                                              sources=[name])
                    if self._files().get(name) != version:
                        raise ValueError("File changed during conversion. Finish the download and retry.")
                    timeline["import"] = {
                        "source": name, "mapping": "config/signal_mapping.json",
                        "mapping_confirmed_by_user": True,
                        "clock_alignment": "single_file_only_not_independently_verified",
                        "coverage": "shared_channel_interval_not_independently_verified",
                        "interpolation": "linear_10_hz",
                        "observed_max_sample_gap_s": gaps,
                    }
                    folder = self.logs / "ergo-replay" / token
                    folder.mkdir(parents=True, exist_ok=True)
                    output = folder / (uuid.uuid4().hex + ".json")
                    temporary = output.with_suffix(".partial")
                    try:
                        temporary.write_text(json.dumps(timeline, allow_nan=False, separators=(",", ":")),
                                             encoding="utf-8")
                        os.replace(temporary, output)
                    finally:
                        temporary.unlink(missing_ok=True)
                    results.append({"name": name, "path": str(output.relative_to(self.root)),
                                    "timeline": timeline})
                    session["files"][name] = version
                    total_frames += len(timeline["t"])
                except SystemExit as exc:
                    errors.append({"name": name, "error": f"MDF reader unavailable: {exc}"})
                except (OSError, ValueError) as exc:
                    errors.append({"name": name, "error": str(exc)})
            return {"results": results, "errors": errors}
        finally:
            self.lock.release()
