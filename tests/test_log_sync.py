import os
import shutil
import tempfile
import unittest

from ergo3d import log_sync as L
from ergo3d.report import evaluate, summarize
from ergo3d.sample_logs import generate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = L.load_json(os.path.join(ROOT, "data", "ex60_spec.json"))

MAPPING = {
    "time": {"aliases": ["time", "timestamp"], "unit": "auto"},
    "channels": {
        "seat_x": {"aliases": ["SeatLongPos"], "scale": 0.1, "offset": -140},
        "steer_tilt": {"aliases": ["ColTilt"]},
    },
}


class LogSync(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def _write(self, name, text):
        p = os.path.join(self.dir, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def test_alias_case_insensitive_scale_offset(self):
        p = self._write("a.csv", "Time,seatlongpos\n0,1400\n1,1500\n")
        ch = L.extract_channels(p, MAPPING)
        self.assertEqual(ch["seat_x"], ([0.0, 1.0], [0.0, 10.0]))

    def test_ms_autodetect_and_offset(self):
        p = self._write("b.csv", "timestamp;ColTilt\n0;1\n100;2\n200;3\n")
        t, v = L.extract_channels(p, MAPPING, offset_s=0.5)["steer_tilt"]
        self.assertEqual(t, [0.5, 0.6, 0.7])
        self.assertEqual(v, [1.0, 2.0, 3.0])

    def test_decimal_comma(self):
        p = self._write("c.csv", "time;ColTilt\n0;1,5\n0,1;2,5\n")
        self.assertEqual(L.extract_channels(p, MAPPING)["steer_tilt"][1], [1.5, 2.5])

    def test_merge_sorts_by_time(self):
        m = L.merge([{"x": ([2.0], [20.0])}, {"x": ([1.0], [10.0])}])
        self.assertEqual(m["x"], ([1.0, 2.0], [10.0, 20.0]))

    def test_interp_holds_edges(self):
        s = ([1.0, 2.0], [10.0, 20.0])
        self.assertEqual(L.interp(s, 0.0), 10.0)
        self.assertEqual(L.interp(s, 1.5), 15.0)
        self.assertEqual(L.interp(s, 9.0), 20.0)

    def test_align_event_sets_time_zero(self):
        ch = {"seat_x": ([0.0, 1.0, 2.0, 3.0], [0.0, 0.0, 5.0, 5.0])}
        tl = L.build_timeline(ch, SPEC, rate_hz=1.0, align_event="seat_x")
        self.assertEqual(tl["t"], [-2.0, -1.0, 0.0, 1.0])
        self.assertIn("seat_z", tl["missing_channels"])

    def test_sample_end_to_end(self):
        mapping = L.load_json(os.path.join(ROOT, "config", "signal_mapping.json"))
        files = generate(self.dir, duration_s=20.0)
        ch = L.merge(L.extract_channels(f, mapping) for f in files)
        tl = L.build_timeline(ch, SPEC, rate_hz=5.0, sources=files)
        self.assertEqual(tl["format"], L.TIMELINE_FORMAT)
        self.assertEqual(tl["missing_channels"], [])
        rows = evaluate(SPEC, tl, "p50_male")
        self.assertEqual(len(rows), len(tl["t"]))
        self.assertIn("frames", summarize(SPEC, tl, rows, "p50_male"))


if __name__ == "__main__":
    unittest.main()
