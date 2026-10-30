import functools
import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from ergo3d.mdf_import import MdfImporter
from ergo3d.nuc_export import ConnectorError
from ergo3d.nuc_server import ViewerHandler


ROOT = Path(__file__).resolve().parents[1]


class MdfImport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.importer = MdfImporter(self.root, ROOT / "data" / "ex60_spec.json")
        (self.root / "config").mkdir()
        self.importer.mapping.write_text(json.dumps({
            "time": {"aliases": ["time"]},
            "channels": {
                "seat_x": {"aliases": ["ActualSeat"], "scale": 1, "offset": 0},
            },
        }))

    def begin(self):
        return self.importer.begin()["session_id"]

    def new_file(self, name="recording.mf4"):
        path = self.importer.logs / name
        path.write_bytes(b"synthetic fixture")
        return path

    def test_only_new_changed_direct_mdf_files_are_selected_and_kept_separate(self):
        self.importer.logs.mkdir(parents=True)
        old = self.new_file("old.mf4")
        token = self.begin()
        self.new_file()
        self.new_file("another.MF4")
        self.new_file("ignore.pcap")
        folder = self.importer.logs / "nested"
        folder.mkdir()
        (folder / "nested.mf4").write_bytes(b"ignored")
        with patch("ergo3d.mdf_import.extract_channels", return_value={"seat_x": ([0, 0.1, 0.2], [1, 2, 3])}):
            result = self.importer.convert(token, True)
            self.assertEqual(len(result["results"]), 2)
            self.assertEqual(result["errors"], [])
            for item in result["results"]:
                timeline = json.loads((self.root / item["path"]).read_text())
                self.assertEqual(timeline["format"], "ergo3d-timeline/1")
                self.assertEqual(timeline["channels"]["seat_x"], [1, 2, 3])
                self.assertEqual(timeline["sources"], [item["name"]])
                self.assertIn("seat_z", timeline["missing_channels"])
                self.assertTrue((self.root / item["path"]).is_relative_to(self.importer.logs))
            with self.assertRaisesRegex(ConnectorError, "No new"):
                self.importer.convert(token, True)
            old.write_bytes(b"modified")
            result = self.importer.convert(token, True)
            self.assertEqual(result["results"][0]["name"], old.name)

    def test_confirmation_session_and_partial_download_guards(self):
        token = self.begin()
        self.new_file()
        with self.assertRaisesRegex(ConnectorError, "Confirm"):
            self.importer.convert(token, False)
        with self.assertRaisesRegex(ConnectorError, "expired"):
            self.importer.convert("unknown", True)
        self.importer.sessions[token]["created"] -= 14401
        with self.assertRaisesRegex(ConnectorError, "expired"):
            self.importer.convert(token, True)
        token = self.begin()
        partial = self.new_file("download.mf4.crdownload")
        with self.assertRaisesRegex(ConnectorError, "unfinished"):
            self.importer.convert(token, True)
        partial.unlink()
        self.assertTrue(self.importer.lock.acquire(False))
        try:
            with self.assertRaisesRegex(ConnectorError, "already running"):
                self.importer.convert(token, True)
        finally:
            self.importer.lock.release()

    def test_failure_retains_retry_and_does_not_create_success_file(self):
        token = self.begin()
        self.new_file()
        for channels in ({}, {"seat_x": ([2, 0], [1, 2])},
                         {"seat_x": ([0, 0], [1, 2])},
                         {"seat_x": ([0, 0.1], [1, float("nan")])},
                         {"seat_x": ([0, 0.1], [1, 2]), "seat_z": ([2, 2.1], [3, 4])}):
            with self.subTest(channels=channels), patch("ergo3d.mdf_import.extract_channels", return_value=channels):
                result = self.importer.convert(token, True)
                self.assertEqual(result["results"], [])
                self.assertEqual(len(result["errors"]), 1)
                self.assertFalse((self.importer.logs / "ergo-replay").exists())
        with patch("ergo3d.mdf_import.extract_channels", side_effect=SystemExit("asammdf missing")):
            self.assertIn("reader unavailable", self.importer.convert(token, True)["errors"][0]["error"])
        with patch("ergo3d.mdf_import.extract_channels", return_value={"seat_x": ([0, .1], [1, 2])}):
            self.assertEqual(len(self.importer.convert(token, True)["results"]), 1)

    def test_rejects_source_changes_during_conversion(self):
        token = self.begin()
        path = self.new_file()
        def changed(*args):
            path.write_bytes(b"changed")
            return {"seat_x": ([0, .1], [1, 2])}
        with patch("ergo3d.mdf_import.extract_channels", side_effect=changed):
            result = self.importer.convert(token, True)
        self.assertIn("changed during", result["errors"][0]["error"])
        self.assertEqual(result["results"], [])

    def test_uses_common_coverage_not_edge_extrapolation(self):
        token = self.begin()
        self.new_file()
        channels = {"seat_x": ([0, .1, .2, .3], [0, 1, 2, 3]),
                    "seat_z": ([.1, .2], [10, 20])}
        with patch("ergo3d.mdf_import.extract_channels", return_value=channels):
            timeline = self.importer.convert(token, True)["results"][0]["timeline"]
        self.assertEqual(timeline["t"], [.1, .2])
        self.assertEqual(timeline["channels"]["seat_x"], [1, 2])

    def test_interpolates_documented_sample_reduction_and_records_spacing(self):
        token = self.begin()
        self.new_file()
        with patch("ergo3d.mdf_import.extract_channels", return_value={"seat_x": ([0, 5], [0, 50])}):
            timeline = self.importer.convert(token, True)["results"][0]["timeline"]
        self.assertEqual(len(timeline["t"]), 51)
        self.assertEqual(timeline["channels"]["seat_x"][25], 25)
        self.assertEqual(timeline["import"]["observed_max_sample_gap_s"]["seat_x"], 5)

    def test_real_mdf_through_http_and_private_output(self):
        try:
            import numpy as np
            from asammdf import MDF, Signal
        except ImportError:
            self.skipTest("Optional asammdf dependency is not installed")
        handler = functools.partial(ViewerHandler, directory=str(self.root), importer=self.importer)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            host = f"127.0.0.1:{server.server_port}"
            def request(path, body=None, origin=None):
                connection = http.client.HTTPConnection(host, timeout=30)
                connection.request("POST" if body is not None else "GET", path,
                                   json.dumps(body) if body is not None else None,
                                   {"Origin": origin or f"http://{host}", "Content-Type": "application/json"})
                response = connection.getresponse()
                status, content = response.status, response.read()
                connection.close()
                return status, content
            self.assertEqual(request("/api/nuc/mdf/begin", {}, "https://untrusted.invalid")[0], 403)
            self.assertEqual(request("/api/nuc/mdf/convert", [])[0], 400)
            status, content = request("/api/nuc/mdf/begin", {})
            self.assertEqual(status, 200)
            token = json.loads(content)["session_id"]
            with MDF(version="4.10") as mdf:
                mdf.append([Signal(np.array([10., 20., 30.]), np.array([0., .1, .2]),
                                   name="ActualSeat", unit="mm")])
                mdf.save(self.importer.logs / "actual.mf4", overwrite=True)
            status, content = request("/api/nuc/mdf/convert", {"session_id": token, "mapping_verified": True})
            result = json.loads(content)
            self.assertEqual(status, 200)
            self.assertEqual(result["errors"], [])
            item = result["results"][0]
            self.assertEqual(item["timeline"]["channels"]["seat_x"], [10, 20, 30])
            self.assertEqual(request("/" + item["path"].replace("\\", "/"))[0], 403)
            token = json.loads(request("/api/nuc/mdf/begin", {})[1])["session_id"]
            (self.importer.logs / "broken.mf4").write_bytes(b"invalid")
            status, content = request("/api/nuc/mdf/convert", {"session_id": token, "mapping_verified": True})
            self.assertEqual(status, 200)
            self.assertEqual(len(json.loads(content)["errors"]), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
