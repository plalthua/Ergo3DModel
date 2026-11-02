import copy
import contextlib
import io
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ergo3d import geometry as G
from ergo3d import report
from ergo3d import cli

SPEC = json.loads((Path(__file__).resolve().parents[1] / "data" / "ex60_spec.json").read_text(encoding="utf-8"))


class GlbProfile(unittest.TestCase):
    def test_profile_is_explicit_and_does_not_mutate_baseline(self):
        baseline = copy.deepcopy(SPEC)
        profile = G.geometry_profile(SPEC, "local_glb")
        self.assertEqual(SPEC, baseline)
        self.assertEqual(profile["meta"]["geometry_profile"], "local_glb")
        self.assertEqual(profile["seat"]["sgrp"]["confidence"], "estimate")
        self.assertEqual(profile["manikins"], SPEC["manikins"])
        self.assertEqual(profile["seat"]["fore_aft_mm"], SPEC["seat"]["fore_aft_mm"])
        self.assertEqual(G.geometry_profile(SPEC)["seat"], SPEC["seat"])
        with self.assertRaisesRegex(ValueError, "Unknown geometry profile"):
            G.geometry_profile(SPEC, "official")

    def test_geometry_anchors_use_same_alignment_as_glb(self):
        profile = G.geometry_profile(SPEC, "local_glb")
        vehicle = SPEC["imported_vehicle"]["value"]
        units, offset = vehicle["units_to_mm"], vehicle["translation_mm"]

        def transformed(point):
            x, y, z = point
            return (x * units + offset[0], -z * units + offset[1], y * units + offset[2])

        sgrp = profile["seat"]["sgrp"]
        for expected, actual in zip(transformed(vehicle["articulation"]["seat"]["pivot"]),
                                    (sgrp["x"], sgrp["y"], sgrp["z"])):
            self.assertAlmostEqual(expected, actual, places=7)
        adj = G.Adjustments.design(profile)
        for actual, expected in zip(G.wheel_center(profile, adj),
                                    transformed(vehicle["articulation"]["steering"]["pivot"])):
            self.assertAlmostEqual(actual, expected, places=7)
        for name, mirror in vehicle["articulation"]["mirrors"].items():
            center = profile["mirrors"][name]["glass_center"]
            for expected, actual in zip(transformed(mirror["pivot"]), (center["x"], center["y"], center["z"])):
                self.assertAlmostEqual(expected, actual, places=7)

    def test_all_profiles_finite_and_design_within_ranges(self):
        profile = G.geometry_profile(SPEC, "local_glb")
        adj = G.Adjustments.design(profile)
        self.assertFalse(any(G.clamp_report(profile, adj).values()))
        for name in profile["manikins"]:
            self.assertTrue(all(math.isfinite(value) for value in G.ergo_metrics(profile, adj, name).values()))
            for key, limit in profile["mirrors"].items():
                recommended = G.recommended_mirror_angles(profile, adj, name, key)
                posed = copy.deepcopy(adj)
                posed.mirror[key] = recommended
                outward, elevation = G.mirror_view(profile, posed, name, key)
                self.assertAlmostEqual(outward, limit["target_view"]["outward_deg"], places=7)
                self.assertAlmostEqual(elevation, limit["target_view"]["elevation_deg"], places=7)

    def test_report_labels_profile_and_preserves_flags(self):
        profile = G.geometry_profile(SPEC, "local_glb")
        timeline = {"t": [0.0], "rate_hz": 10, "channels": {}, "missing_channels": []}
        rows = report.evaluate(profile, timeline, "p50_male")
        summary = report.summarize(profile, timeline, rows, "p50_male")
        self.assertEqual(summary["geometry_profile"], "local_glb")
        self.assertEqual(summary["geometry_confidence"], "estimate")
        self.assertTrue(any(value for key, value in rows[0].items() if key.startswith("flag_")))

    def test_all_panel_and_mirror_bindings_are_estimate_sourced(self):
        rig = SPEC["imported_vehicle"]["value"]["articulation"]
        self.assertEqual(rig["confidence"], "estimate")
        self.assertEqual(set(rig["panels"]), {"front_left", "front_right", "rear_left", "rear_right", "tailgate", "frunk"})
        self.assertEqual(set(rig["panels"]), set(SPEC["visual_reconstruction"]["openings"]["value"]["panels"]))
        self.assertEqual(rig["panels"]["frunk"]["nodes"], ["Bonnet"])
        self.assertEqual(rig["mirrors"]["left"]["panel"], "front_left")
        self.assertEqual(rig["mirrors"]["right"]["panel"], "front_right")
        for mesh in rig["island_meshes"]:
            seeds = [seed for part in mesh["parts"].values() for seed in part]
            self.assertEqual(len(seeds), len(set(seeds)))

    def test_cli_report_keeps_geometry_outputs_separate(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary, patch.object(cli, "ROOT", temporary):
            with contextlib.redirect_stdout(io.StringIO()):
                code = cli.main(["report", str(root / "data" / "timelines" / "sample_timeline.json"),
                                 "--geometry", "local_glb"])
            self.assertEqual(code, 0)
            summary_path = Path(temporary) / "reports" / "sample_timeline_p50_male_local_glb_summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(summary["geometry_profile"], "local_glb")
            self.assertFalse((Path(temporary) / "reports" / "sample_timeline_p50_male.csv").exists())
