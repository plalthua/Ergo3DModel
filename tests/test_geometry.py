import math
import copy
import os
import unittest

from ergo3d import geometry as G
from ergo3d.log_sync import load_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = load_json(os.path.join(ROOT, "data", "ex60_spec.json"))


class DesignPosition(unittest.TestCase):
    def setUp(self):
        self.adj = G.Adjustments.design(SPEC)

    def test_h_point_equals_sgrp_at_design(self):
        sg = SPEC["seat"]["sgrp"]
        self.assertEqual(G.h_point(SPEC, self.adj), (sg["x"], sg["y"], sg["z"]))

    def test_wheel_centre_equals_design_at_neutral_column(self):
        wc = SPEC["steering"]["wheel_center_design"]
        for a, b in zip(G.wheel_center(SPEC, self.adj), (wc["x"], wc["y"], wc["z"])):
            self.assertAlmostEqual(a, b, places=6)

    def test_p50_design_metrics_within_limits(self):
        m = G.ergo_metrics(SPEC, self.adj, "p50_male")
        self.assertAlmostEqual(m["hpoint_to_wheel_mm"], 542.0, delta=0.5)
        self.assertGreater(m["cluster_sightline_margin_mm"], 0)
        self.assertGreater(m["headroom_mm"], 0)
        self.assertFalse(any(G.ergo_flags(SPEC, m).values()))

    def test_design_within_adjustment_ranges(self):
        self.assertFalse(any(G.clamp_report(SPEC, self.adj).values()))


class Kinematics(unittest.TestCase):
    def test_driver_display_visibility_modes(self):
        adj = G.Adjustments.design(SPEC)
        legacy = copy.deepcopy(SPEC)
        legacy["displays"]["driver"].update(
            center={"x": 640, "y": -370, "z": 1075}, tilt_deg=20,
            visibility_mode="through_wheel")
        for name, expected in (("p5_female", -1.5), ("p50_male", 13.5), ("p95_male", -4.5)):
            self.assertAlmostEqual(G.cluster_sightline_margin(legacy, adj, name), expected, delta=0.1)
        del legacy["displays"]["driver"]["visibility_mode"]
        self.assertAlmostEqual(G.cluster_sightline_margin(legacy, adj, "p50_male"), 13.5, delta=0.1)
        for name in SPEC["manikins"]:
            eye = G.eye_point(SPEC, adj, name)
            center = G.wheel_center(SPEC, adj)
            axis = G.steering_axis(SPEC, adj)
            up = G.wheel_up(SPEC, adj)
            height = []
            for target in G.driver_display_edges(SPEC):
                direction = G.sub(target, eye)
                intersection = G.add(eye, G.scale(direction, G.dot(G.sub(center, eye), axis) / G.dot(direction, axis)))
                height.append(G.dot(G.sub(intersection, center), up))
            st = SPEC["steering"]
            radius = (st["rim_diameter"]["value"] + st["rim_thickness"]["value"]) / 2
            self.assertAlmostEqual(G.cluster_sightline_margin(SPEC, adj, name), min(height) - radius, places=9)
        invalid = copy.deepcopy(SPEC)
        invalid["displays"]["driver"]["visibility_mode"] = "unknown"
        with self.assertRaisesRegex(ValueError, "Unknown driver display visibility mode"):
            G.cluster_sightline_margin(invalid, adj, "p50_male")

    def test_seat_rail_rises_forward(self):
        adj = G.Adjustments.design(SPEC)
        h0 = G.h_point(SPEC, adj)
        adj.seat_x -= 50  # move forward
        self.assertGreater(G.h_point(SPEC, adj)[2], h0[2])

    def test_telescope_moves_wheel_along_axis(self):
        adj = G.Adjustments.design(SPEC)
        w0 = G.wheel_center(SPEC, adj)
        adj.steer_telescope = 20
        d = G.sub(G.wheel_center(SPEC, adj), w0)
        self.assertAlmostEqual(G.norm(d), 20, places=6)
        self.assertAlmostEqual(G.dot(G.unit(d), G.steering_axis(SPEC, adj)), 1, places=9)

    def test_reflection_preserves_length_and_flips_normal_component(self):
        n = G.mirror_normal(20, 5)
        d = G.unit((-1.0, -0.3, 0.1))
        r = G.reflect(d, n)
        self.assertAlmostEqual(G.norm(r), 1, places=9)
        self.assertAlmostEqual(G.dot(r, n), -G.dot(d, n), places=9)


class Mirrors(unittest.TestCase):
    def test_recommended_angles_hit_target_for_all_manikins(self):
        for mk in SPEC["manikins"]:
            adj = G.Adjustments.design(SPEC)
            for m in G.MIRRORS:
                adj.mirror[m] = G.recommended_mirror_angles(SPEC, adj, mk, m)
            met = G.ergo_metrics(SPEC, adj, mk)
            for m in G.MIRRORS:
                with self.subTest(manikin=mk, mirror=m):
                    self.assertLess(met[f"mirror_{m}_view_error_deg"], 1e-6)

    def test_left_mirror_yaw_positive_right_negative(self):
        adj = G.Adjustments.design(SPEC)
        self.assertGreater(G.recommended_mirror_angles(SPEC, adj, "p50_male", "left")[0], 0)
        self.assertLess(G.recommended_mirror_angles(SPEC, adj, "p50_male", "right")[0], 0)


class FromChannels(unittest.TestCase):
    def test_missing_and_nan_fall_back_to_design(self):
        d = G.Adjustments.design(SPEC)
        a = G.Adjustments.from_channels(SPEC, {"seat_x": 30.0, "seat_z": math.nan, "mirror_left_yaw": 10.0})
        self.assertEqual(a.seat_x, 30.0)
        self.assertEqual(a.seat_z, d.seat_z)
        self.assertEqual(a.mirror["left"], (10.0, d.mirror["left"][1]))
        self.assertEqual(a.mirror["right"], d.mirror["right"])


class DriverProfiles(unittest.TestCase):
    def test_profiles_have_estimate_provenance_and_positive_dimensions(self):
        sources = {source["id"] for source in SPEC["meta"]["sources"]}
        fields = ("h_to_eye", "eye_forward", "h_to_shoulder", "upper_arm",
                  "forearm_hand", "thigh", "shank", "ankle_height",
                  "head_above_eye", "shoulder_half_width", "hip_half_width")
        body_fields = ("torso_depth", "waist_half_width", "pelvis_depth",
                       "upper_arm_radius", "forearm_radius", "thigh_radius",
                       "calf_radius", "neck_radius", "head_depth",
                       "head_half_width", "head_below_eye", "foot_length", "foot_radius")
        self.assertEqual(len(SPEC["manikins"]), 9)
        for name, profile in SPEC["manikins"].items():
            with self.subTest(profile=name):
                self.assertEqual(profile["confidence"], "estimate")
                self.assertIn(profile["source"], sources)
                for field in fields:
                    self.assertGreater(profile[field], 0)
                for field in body_fields:
                    self.assertGreater(profile["body"][field], 0)
                self.assertGreater(profile["h_to_eye"], profile["h_to_shoulder"])

    def test_teenage_examples_are_explicitly_illustrative(self):
        teens = [p for p in SPEC["manikins"].values() if p["category"] == "Teenage"]
        self.assertEqual(len(teens), 2)
        for profile in teens:
            self.assertIn("Illustrative", profile["description"])
            self.assertIn("not an age percentile", profile["description"])

    def test_metrics_are_finite_for_every_profile(self):
        for name in SPEC["manikins"]:
            metrics = G.ergo_metrics(SPEC, G.Adjustments.design(SPEC), name)
            with self.subTest(profile=name):
                self.assertTrue(all(math.isfinite(value) for value in metrics.values()))

    def test_original_non_display_design_metrics_preserved(self):
        adj = G.Adjustments.design(SPEC)
        for name, headroom in (
            ("p5_female", 197.2),
            ("p50_male", 105.6),
            ("p95_male", 32.6),
        ):
            metrics = G.ergo_metrics(SPEC, adj, name)
            with self.subTest(profile=name):
                self.assertAlmostEqual(metrics["headroom_mm"], headroom, delta=0.1)

    def test_customization_paths_are_positive_dimensions(self):
        controls = SPEC["manikin_rendering"]["customization"]
        self.assertEqual(len({c["id"] for c in controls}), len(controls))
        for control in controls:
            self.assertGreater(control["min"], 0)
            self.assertLessEqual(control["min"], 100)
            self.assertGreaterEqual(control["max"], 100)
            self.assertGreater(control["step"], 0)
            for profile in SPEC["manikins"].values():
                for path in control["paths"]:
                    if path != "*":
                        value = profile
                        for key in path.split("."):
                            value = value[key]
                        self.assertIsInstance(value, (int, float))
                        self.assertGreater(value, 0)


if __name__ == "__main__":
    unittest.main()
