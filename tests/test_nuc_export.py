import functools
import hashlib
import http.client
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from ergo3d.nuc_export import ShareConnector, ConnectorError, read_config, request_bounds
from ergo3d.nuc_server import ViewerHandler


VIN = "ABC12345678901234"
REQUEST = {"vin": VIN, "start": "2026-10-30T10:00:00Z", "end": "2026-10-30T10:01:00Z"}


def recording(path="record.asc", **updates):
    return {**REQUEST, "path": path, **updates}


class NucFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.share = self.root / "share"
        self.share.mkdir()
        (self.share / "record.asc").write_bytes(b"log")
        self.index = self.root / "index.json"
        self.write_index([recording()])
        self.config_path = self.root / "share.json"
        self.settings = {"root": str(self.share), "index": str(self.index)}
        self.config = self.configure()
        self.connector = ShareConnector(self.config, self.root / "sessions")

    def write_index(self, rows):
        self.index.write_text(json.dumps({"format": "ergo3d-share-index/1", "recordings": rows}), encoding="utf-8")

    def configure(self, **updates):
        self.config_path.write_text(json.dumps({**self.settings, **updates}), encoding="utf-8")
        return read_config(str(self.config_path))


class NucExport(NucFixture):
    def test_strict_config_and_no_azure_dependency(self):
        for changes in (
            {"root": "https://nuc.volvocars.net/tools/drive.html"},
            {"root": "relative-folder"}, {"index": "relative.json"},
            {"root": "\\\\?\\C:\\device"}, {"max_scan": True}, {"max_bytes": 0},
            {"account": "old-azure-config"}, {"password": "not-allowed"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ConnectorError):
                self.configure(**changes)
        self.assertEqual(self.config["root"], str(self.share.resolve()))

    def test_request_validation_and_utc(self):
        vin, start, end = request_bounds({**REQUEST, "start": "2026-10-30T11:00:00+01:00"})
        self.assertEqual(vin, VIN)
        self.assertEqual((end - start).total_seconds(), 60)
        for changes in (
            {"vin": "I" * 17}, {"vin": VIN.lower()}, {"start": "2026-10-30T10:00:00"},
            {"start": None}, {"end": REQUEST["start"]}, {"end": "2026-10-30T09:00:00Z"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ConnectorError):
                request_bounds({**REQUEST, **changes})

    def test_half_open_selection_and_wrong_vin_exclusion(self):
        for name in ("before.asc", "after.asc"):
            (self.share / name).write_bytes(b"log")
        self.write_index([
            recording(),
            recording("before.asc", start="2026-10-30T09:00:00Z", end=REQUEST["start"]),
            recording("after.asc", start=REQUEST["end"], end="2026-10-30T11:00:00Z"),
            recording("another-vehicle.asc", vin="Z" * 17),
        ])
        result = self.connector.preview(REQUEST)
        self.assertEqual(result["scanned"], 3)
        self.assertEqual(len(result["files"]), 1)
        self.assertEqual(result["bytes"], 3)
        self.assertFalse(any((self.root / "sessions").iterdir()))

    def test_metadata_is_required_not_inferred_from_file_mtime(self):
        for row in (
            {"path": "record.asc"}, recording(vin="unknown"), recording(start="unknown"),
            recording(end=REQUEST["start"]), recording(sha256="invalid"),
        ):
            self.write_index([row])
            with self.subTest(row=row), self.assertRaises(ConnectorError):
                self.connector.preview(REQUEST)
            self.assertEqual(self.connector.plans, {})

    def test_path_escape_and_device_syntax_rejected(self):
        for path in ("..\\outside.asc", "/outside.asc", "C:\\outside.asc", "\\\\server\\file",
                     "record.asc:stream", "folder.\\record.asc", "folder \\record.asc", "*.asc", "NUL"):
            self.write_index([recording(path)])
            with self.subTest(path=path), self.assertRaises(ConnectorError):
                self.connector.preview(REQUEST)

    def test_source_links_rejected(self):
        outside = self.root / "outside.asc"
        outside.write_bytes(b"private")
        link = self.share / "linked.asc"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("Creating symlinks requires Windows permission")
        self.write_index([recording("linked.asc")])
        with self.assertRaises(ConnectorError):
            self.connector.preview(REQUEST)

    def test_duplicate_and_limits_reject_partial_previews(self):
        self.write_index([recording(), recording("RECORD.ASC")])
        with self.assertRaisesRegex(ConnectorError, "Duplicated"):
            self.connector.preview(REQUEST)
        (self.share / "second.asc").write_bytes(b"log")
        self.write_index([recording(), recording("second.asc")])
        for limit in ("max_scan", "max_files", "max_bytes"):
            connector = ShareConnector({**self.config, limit: 1}, self.root / "sessions")
            with self.subTest(limit=limit), self.assertRaises(ConnectorError):
                connector.preview(REQUEST)
            self.assertEqual(connector.plans, {})

    def test_missing_index_and_bad_schema(self):
        self.index.unlink()
        with self.assertRaisesRegex(ConnectorError, "access failed"):
            self.connector.preview(REQUEST)
        for content in ('[]', '{"format":"unknown"}', 'not json'):
            self.index.write_text(content)
            with self.subTest(content=content), self.assertRaises(ConnectorError):
                self.connector.preview(REQUEST)

    def test_no_matches(self):
        self.write_index([recording(vin="Z" * 17)])
        with self.assertRaisesRegex(ConnectorError, "No recording"):
            self.connector.preview(REQUEST)

    def test_download_writes_manifest_hashes_and_does_not_change_source(self):
        expected = hashlib.sha256(b"log").hexdigest()
        self.write_index([recording(sha256=expected)])
        plan = self.connector.preview(REQUEST)
        result = self.connector.download(plan["plan_id"])
        session = Path(result["session"])
        self.assertTrue(session.is_relative_to(self.root / "sessions"))
        self.assertEqual((session / "raw" / "0000.asc").read_bytes(), b"log")
        manifest = json.loads(Path(result["manifest"]).read_text())
        self.assertEqual(manifest["status"], "downloaded")
        self.assertEqual(manifest["source"]["type"], "share")
        self.assertEqual(manifest["alignment"], "not_performed")
        self.assertEqual(manifest["replay"], "not_generated")
        self.assertEqual(manifest["files"][0]["sha256"], expected)
        self.assertEqual(manifest["files"][0]["verification"], "source_version_size_and_sha256")
        self.assertEqual((self.share / "record.asc").read_bytes(), b"log")
        with self.assertRaisesRegex(ConnectorError, "already used"):
            self.connector.download(plan["plan_id"])

    def test_expired_preview(self):
        plan = self.connector.preview(REQUEST)
        self.connector.plans[plan["plan_id"]]["created"] = time.monotonic() - 901
        with self.assertRaisesRegex(ConnectorError, "expired"):
            self.connector.download(plan["plan_id"])

    def test_source_changed_after_preview(self):
        plan = self.connector.preview(REQUEST)
        (self.share / "record.asc").write_bytes(b"changed")
        with self.assertRaisesRegex(ConnectorError, "changed since preview"):
            self.connector.download(plan["plan_id"])
        manifest = next((self.root / "sessions").glob("*/manifest.json"))
        self.assertEqual(json.loads(manifest.read_text())["status"], "failed")

    def test_source_changed_during_copy(self):
        plan = self.connector.preview(REQUEST)
        resolve_path = self.connector.source.path
        calls = 0

        def mutate(name):
            nonlocal calls
            calls += 1
            if calls == 2:
                (self.share / "record.asc").write_bytes(b"new")
            return resolve_path(name)

        with patch.object(self.connector.source, "path", side_effect=mutate):
            with self.assertRaisesRegex(ConnectorError, "changed during copy"):
                self.connector.download(plan["plan_id"])

    def test_hash_mismatch_retains_partial_file_and_failed_manifest(self):
        self.write_index([recording(sha256="0" * 64)])
        plan = self.connector.preview(REQUEST)
        with self.assertRaisesRegex(ConnectorError, "SHA-256 mismatch"):
            self.connector.download(plan["plan_id"])
        manifest_path = next((self.root / "sessions").glob("*/manifest.json"))
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest["status"], "failed")
        self.assertEqual(manifest["selection"][0]["name"], "record.asc")
        self.assertTrue((manifest_path.parent / "raw" / "0000.asc.partial").exists())

    def test_disk_space_and_simultaneous_copy(self):
        with patch("ergo3d.nuc_export.shutil.disk_usage") as usage:
            usage.return_value.free = 1
            with self.assertRaisesRegex(ConnectorError, "disk"):
                self.connector.preview(REQUEST)
        plan = self.connector.preview(REQUEST)
        with self.connector.transfer_lock:
            with self.assertRaisesRegex(ConnectorError, "Another download"):
                self.connector.download(plan["plan_id"])
        self.assertIn(plan["plan_id"], self.connector.plans)


class QuietViewerHandler(ViewerHandler):
    def log_message(self, *args):
        pass


class NucHttp(NucFixture):
    def setUp(self):
        super().setUp()
        handler = functools.partial(QuietViewerHandler, directory=str(self.root), connector=self.connector)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.host = f"127.0.0.1:{self.server.server_port}"

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def send(self, path, body=None, headers=None, method=None):
        connection = http.client.HTTPConnection(self.host, timeout=5)
        request_headers = {"Origin": f"http://{self.host}", "Content-Type": "application/json"}
        request_headers.update(headers or {})
        connection.request(method or ("POST" if body is not None else "GET"), path,
                           json.dumps(body) if body is not None else None, request_headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_http_preview_download(self):
        status, content = self.send("/api/nuc/status")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(content)["configured"])
        self.assertIn("Share drive", json.loads(content)["message"])
        status, content = self.send("/api/nuc/preview", REQUEST)
        self.assertEqual(status, 200)
        status, content = self.send("/api/nuc/download", {"plan_id": json.loads(content)["plan_id"]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(content)["files"], 1)

    def test_http_rejects_cross_origin_host_and_invalid_requests(self):
        for headers in (
            {"Origin": "https://untrusted.invalid"}, {"Origin": "null"},
            {"Host": "untrusted.invalid"}, {"Sec-Fetch-Site": "cross-site"},
        ):
            with self.subTest(headers=headers):
                self.assertEqual(self.send("/api/nuc/preview", REQUEST, headers)[0], 403)
        self.assertEqual(self.send("/api/nuc/preview", [])[0], 400)
        self.assertEqual(self.send("/api/nuc/preview", {})[0], 400)
        self.assertEqual(self.send("/api/nuc/download", {"plan_id": "untrusted"})[0], 400)
        self.assertEqual(self.send("/api/nuc/preview", REQUEST, {"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.connector.plans, {})

    def test_private_artifacts_not_served(self):
        private = self.root / "data" / "logs"
        private.mkdir(parents=True)
        (private / "config.json").write_text('{"private":true}')
        for path in ("/data/logs/config.json", "/data/%6cogs/config.json", "/data/./logs/config.json",
                     "/data/logs/", "/data/x/../logs/config.json", "/data/logs./config.json",
                     "/data/logs%20/config.json", "/data/logs::$INDEX_ALLOCATION/config.json"):
            with self.subTest(path=path):
                self.assertEqual(self.send(path)[0], 403)
                self.assertEqual(self.send(path, method="HEAD")[0], 403)
