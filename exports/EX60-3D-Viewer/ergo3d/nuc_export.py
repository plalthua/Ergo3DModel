"""Read-only acquisition from an indexed mounted share or local download folder."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import BinaryIO


class ConnectorError(ValueError):
    """An actionable acquisition failure safe to display in the viewer."""


def utc(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ConnectorError("Recording times must be ISO-8601 timestamps with a timezone.") from exc


def request_bounds(data: dict):
    vin = data.get("vin")
    if not isinstance(vin, str) or not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin):
        raise ConnectorError("VIN must be 17 uppercase letters/digits, excluding I, O and Q.")
    start, end = utc(data.get("start")), utc(data.get("end"))
    if end <= start:
        raise ConnectorError("End time must be later than start time.")
    return vin, start, end


def read_config(path: str) -> dict:
    with open(path, encoding="utf-8") as stream:
        config = json.load(stream)
    if not isinstance(config, dict):
        raise ConnectorError("Share configuration must be a JSON object.")
    required = {"root", "index"}
    allowed = required | {"max_scan", "max_files", "max_bytes"}
    if not required <= config.keys() or config.keys() - allowed:
        raise ConnectorError("Share config requires root and index; unknown fields are rejected. Azure Blob is no longer used.")
    for key in ("root", "index"):
        value = config[key]
        if (not isinstance(value, str) or not value or "://" in value
                or not Path(value).is_absolute() or value.startswith(("\\\\?\\", "\\\\.\\"))):
            raise ConnectorError(f"{key} must be an absolute mounted-share or local filesystem path, not a web URL.")
        config[key] = str(Path(value).resolve())
    for key, default, ceiling in (
        ("max_scan", 1000, 10000), ("max_files", 100, 1000),
        ("max_bytes", 20 * 1024**3, 1024**4),
    ):
        config.setdefault(key, default)
        if type(config[key]) is not int or not 1 <= config[key] <= ceiling:
            raise ConnectorError(f"{key} must be an integer between 1 and {ceiling}.")
    return config


def file_version(info) -> str:
    return f"{info.st_dev}:{info.st_ino}:{info.st_size}:{info.st_mtime_ns}:{info.st_ctime_ns}"


class ShareSource:
    def __init__(self, config: dict):
        self.root = Path(config["root"]).resolve(strict=True)
        if not self.root.is_dir():
            raise ConnectorError("Share root is not a directory. Check the mapped drive/UNC path and Windows permissions.")
        self.index = Path(config["index"])
        self.max_scan = config["max_scan"]

    def path(self, name: str) -> Path:
        if not isinstance(name, str) or not name:
            raise ConnectorError("Every index entry requires a relative recording path.")
        relative = PureWindowsPath(name)
        if (relative.drive or relative.root or relative.is_reserved()
                or any(part in (".", "..") for part in re.split(r"[\\/]", name))
                or any(c in name for c in (":", "\0", "*", "?", "\r", "\n"))
                or any(part.endswith((" ", ".")) for part in relative.parts)):
            raise ConnectorError("Recording paths must be relative, without traversal, wildcards or device/stream syntax.")
        candidate = self.root.joinpath(*relative.parts)
        resolved = candidate.resolve(strict=True)
        if self.root not in resolved.parents or not resolved.is_file():
            raise ConnectorError("Recording path must identify a file inside the approved share root.")
        # Reject links/junctions so the index cannot redirect reads through reparse points.
        current = self.root
        for part in relative.parts:
            current = current / part
            info = current.lstat()
            if current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ConnectorError("Linked/reparse recording paths are not supported.")
        return resolved

    def list(self, vin: str):
        try:
            with self.index.open("rb") as stream:
                content = stream.read(8 * 1024**2 + 1)
            if len(content) > 8 * 1024**2:
                raise ConnectorError("Share index exceeds 8 MiB. Use a narrower session index.")
            index = json.loads(content)
            if not isinstance(index, dict) or index.get("format") != "ergo3d-share-index/1":
                raise ConnectorError("Expected an ergo3d-share-index/1 recording index.")
            rows = index.get("recordings")
            if not isinstance(rows, list) or len(rows) > self.max_scan:
                raise ConnectorError("Share index recording limit exceeded or recordings is not a list.")
            seen = set()
            for row in rows:
                if not isinstance(row, dict):
                    raise ConnectorError("Recording index entries must be objects.")
                row_vin, start, end = request_bounds(row)
                name = row.get("path")
                if not isinstance(name, str) or not name:
                    raise ConnectorError("Every index entry requires a relative recording path.")
                identity = str(PureWindowsPath(name)).casefold()
                if identity in seen:
                    raise ConnectorError("Duplicated recording path in share index.")
                seen.add(identity)
                expected_hash = row.get("sha256")
                if expected_hash is not None and (
                    not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash)
                ):
                    raise ConnectorError("Optional source sha256 must be 64 lowercase hexadecimal digits.")
                if row_vin != vin:
                    continue
                path = self.path(name)
                info = path.stat()
                yield {
                    "name": name, "size": info.st_size, "source_version": file_version(info),
                    "start": start.isoformat(), "end": end.isoformat(), "sha256_expected": expected_hash,
                }
        except (OSError, ValueError) as exc:
            if isinstance(exc, ConnectorError):
                raise
            raise ConnectorError(
                "Share index/file access failed. Check Windows share permissions, VPN, mapped drive "
                "and the recording index JSON. No website credentials are used."
            ) from exc

    def download(self, item: dict, stream: BinaryIO) -> None:
        try:
            path = self.path(item["name"])
            written = 0
            with path.open("rb") as source:
                if file_version(os.fstat(source.fileno())) != item["source_version"]:
                    raise ConnectorError("Source recording changed since preview. Preview again.")
                for chunk in iter(lambda: source.read(1024**2), b""):
                    written += len(chunk)
                    if written > item["size"]:
                        raise ConnectorError("Source recording grew during copy; transfer stopped.")
                    stream.write(chunk)
                if (file_version(os.fstat(source.fileno())) != item["source_version"]
                        or file_version(self.path(item["name"]).stat()) != item["source_version"]):
                    raise ConnectorError("Source recording changed during copy. Preview again.")
        except OSError as exc:
            raise ConnectorError(
                "Share copy failed. Check Windows share permissions, source availability and VPN."
            ) from exc

    def close(self):
        pass


class ShareConnector:
    def __init__(self, config: dict, destination: Path, source=None):
        self.config = config
        self.destination = destination
        self.source = source if source is not None else ShareSource(config)
        self.lock = threading.Lock()
        self.transfer_lock = threading.Lock()
        self.plans = {}

    def close(self):
        self.source.close()

    def preview(self, data: dict) -> dict:
        vin, start, end = request_bounds(data)
        selected = []
        seen = set()
        scanned = 0
        for item in self.source.list(vin):
            scanned += 1
            if scanned > self.config["max_scan"]:
                raise ConnectorError("Listing limit exceeded. Configure a narrower recording index; no partial preview accepted.")
            if not isinstance(item, dict):
                raise ConnectorError("Unexpected share listing record.")
            name, size, version = item.get("name"), item.get("size"), item.get("source_version")
            if (not isinstance(name, str) or name in seen
                    or type(size) is not int or size < 0 or not isinstance(version, str) or not version):
                raise ConnectorError("Invalid or duplicated share listing entry.")
            seen.add(name)
            a, b = utc(item.get("start")), utc(item.get("end"))
            if b <= a:
                raise ConnectorError("Invalid recording interval in share index.")
            if a < end and b > start:
                selected.append({
                    "name": name, "size": size, "source_version": version,
                    "sha256_expected": item.get("sha256_expected"),
                    "start": a.isoformat(), "end": b.isoformat(),
                })
                if len(selected) > self.config["max_files"]:
                    raise ConnectorError("Selected file limit exceeded. Narrow the recording interval.")
        if not selected:
            raise ConnectorError("No recording chunks overlap the requested VIN and UTC interval.")
        total = sum(item["size"] for item in selected)
        if total > self.config["max_bytes"]:
            raise ConnectorError("Selected bytes exceed the configured download limit.")
        self.destination.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self.destination).free < total + 64 * 1024**2:
            raise ConnectorError("Insufficient free disk space for the selected download.")
        plan_id = uuid.uuid4().hex
        plan = {
            "vin": vin, "start": start.isoformat(), "end": end.isoformat(),
            "files": selected, "bytes": total, "created": time.monotonic(),
        }
        with self.lock:
            self.plans = {key: value for key, value in self.plans.items()
                          if time.monotonic() - value["created"] < 900}
            if len(self.plans) >= 16:
                raise ConnectorError("Too many pending previews. Wait for older previews to expire.")
            self.plans[plan_id] = plan
        return {"plan_id": plan_id, "files": selected, "bytes": total, "scanned": scanned,
                "destination": str(self.destination), "expires_seconds": 900}

    def download(self, plan_id: str) -> dict:
        if not self.transfer_lock.acquire(blocking=False):
            raise ConnectorError("Another download is running. Wait for it to finish.")
        try:
            return self._download(plan_id)
        finally:
            self.transfer_lock.release()

    def _download(self, plan_id: str) -> dict:
        if not isinstance(plan_id, str):
            raise ConnectorError("A valid preview identifier is required.")
        with self.lock:
            plan = self.plans.pop(plan_id, None)
            if plan is None or time.monotonic() - plan["created"] >= 900:
                raise ConnectorError("Preview expired or already used. Preview again.")
        if shutil.disk_usage(self.destination).free < plan["bytes"] + 64 * 1024**2:
            raise ConnectorError("Insufficient free disk space for download.")
        session = self.destination / ("nuc-" + uuid.uuid4().hex)
        raw = session / "raw"
        raw.mkdir(parents=True, exist_ok=False)
        manifest = {
            "format": "ergo3d-log-session/1", "status": "downloading",
            "vin": plan["vin"], "start": plan["start"], "end": plan["end"],
            "source": {"type": "share", "root": self.config["root"], "index": self.config["index"]},
            "alignment": "not_performed", "replay": "not_generated",
            "selection": plan["files"], "files": [],
        }
        manifest_path = session / "manifest.json"

        def save():
            staging = session / "manifest.tmp"
            staging.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            staging.replace(manifest_path)

        save()
        try:
            for index, item in enumerate(plan["files"]):
                # Generate local names independently from share-relative paths.
                suffix = Path(item["name"]).suffix.lower()
                suffix = suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"
                target = raw / f"{index:04d}{suffix}"
                partial = target.with_suffix(target.suffix + ".partial")
                with partial.open("xb") as stream:
                    self.source.download(item, stream)
                if partial.stat().st_size != item["size"]:
                    raise ConnectorError("Downloaded size differs from preview; incomplete file retained as .partial.")
                digest = hashlib.sha256()
                with partial.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024**2), b""):
                        digest.update(chunk)
                if item["sha256_expected"] is not None and digest.hexdigest() != item["sha256_expected"]:
                    raise ConnectorError("Source SHA-256 mismatch; unverified file retained as .partial.")
                partial.rename(target)
                manifest["files"].append({
                    **item, "local_path": str(target.relative_to(session)),
                    "sha256": digest.hexdigest(),
                    "verification": "source_version_size_and_sha256" if item["sha256_expected"] else "source_version_and_size",
                })
                save()
            manifest["status"] = "downloaded"
            save()
        except (ConnectorError, OSError) as exc:
            manifest["status"] = "failed"
            save()
            raise ConnectorError(
                f"Download failed; partial session retained at {session}. {exc}"
            ) from exc
        return {
            "session": str(session), "manifest": str(manifest_path),
            "files": len(manifest["files"]), "bytes": plan["bytes"],
            "message": "Logs downloaded locally. Clock alignment, decoding and replay have not been performed.",
        }
