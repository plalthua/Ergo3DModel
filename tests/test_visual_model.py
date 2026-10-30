import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / "data" / "ex60_spec.json").read_text(encoding="utf-8"))


class VisualModelSpec(unittest.TestCase):
    def test_reference_remodel_is_explicitly_uncalibrated(self):
        visual = SPEC["visual_reconstruction"]
        sources = {s["id"] for s in SPEC["meta"]["sources"]}
        for key in ("reference_remodel", "cabin_seating"):
            self.assertEqual(visual[key]["confidence"], "estimate")
            self.assertIn(visual[key]["source"], sources)
        self.assertEqual(SPEC["displays"]["driver"]["visibility_mode"], "above_rim")
        self.assertEqual(SPEC["seat"]["sgrp"]["y"], -370)
        layout = visual["cabin_seating"]["value"]
        self.assertEqual(layout["passenger_h_point"], [1330, 370, 700])
        self.assertEqual(len(layout["rear_centers_y_mm"]), 3)
        self.assertEqual(sum(layout["rear_centers_y_mm"]), 0)
        glass = visual["reference_remodel"]["value"]["windscreen"]
        self.assertGreater(glass["bow_mm"], 40)
        self.assertGreater(glass["rows"], 12)
        self.assertGreater(glass["columns"], 12)
        self.assertTrue(0 < glass["surround_fraction"] < 0.1)
        self.assertTrue(1 < glass["material"]["ior"] < 2)
        self.assertEqual(glass["material"]["metalness"], 0)
        self.assertTrue(any("uncalibrated photo" in s for s in SPEC["meta"]["data_gaps"]))

    def test_steering_detail_is_bounded_and_estimate_sourced(self):
        trim = SPEC["visual_reconstruction"]["dashboard"]["steering_trim"]
        self.assertEqual(trim["confidence"], "estimate")
        self.assertEqual(trim["source"], "local_gallery_visual")
        self.assertIn("circular", trim["note"])
        rim = trim["rim"]
        self.assertTrue(2 < rim["superellipse_exponent"] < 4)
        self.assertTrue(72 <= rim["segments"] <= 240)
        self.assertTrue(12 <= rim["cross_segments"] <= 32)
        self.assertEqual(rim["depth_ratio"], 1)
        self.assertTrue(0 < trim["grain"]["size"] <= 256)
        self.assertGreater(trim["grain"]["tile_mm"], 0)
        self.assertTrue(0 < trim["seam"]["stitch_count"] <= 300)
        self.assertTrue(0 < trim["seam"]["stitch_length_ratio"] < 1)
        for material in trim["materials"].values():
            self.assertTrue(0 <= material["roughness"] <= 1)
            self.assertTrue(0 <= material["metalness"] <= 1)
        self.assertGreater(trim["materials"]["leather"]["bumpScale"], 0)
        for key in ("hub_rings", "accent_rings", "spoke_rings", "control_rings", "rocker_rings"):
            rings = trim[key]
            self.assertEqual([r[0] for r in rings], sorted(r[0] for r in rings))
            self.assertTrue(all(len(r) == 5 and all(math.isfinite(v) for v in r) for r in rings))
        radius = SPEC["steering"]["rim_diameter"]["value"] / 2
        self.assertTrue(all(abs(p[0]) < radius and abs(p[1]) < radius
                            for p in trim["lower_open_trim"]))

    def test_inspection_transparency_is_see_through_and_localized(self):
        visual = SPEC["visual_reconstruction"]
        inspection = visual["inspection_transparency"]["value"]
        self.assertEqual(inspection["door_opacity"], 0.4)
        self.assertTrue(0 < inspection["roof_opacity"] < 0.3)
        self.assertTrue(0 < visual["roof_glass_opacity"] < 0.3)
        self.assertLess(inspection["door_x_min"], inspection["door_x_max"])
        self.assertNotIn("transparent", visual["body_material"])

    def test_visual_reconstruction_has_estimate_provenance(self):
        visual = SPEC["visual_reconstruction"]
        source_ids = {source["id"] for source in SPEC["meta"]["sources"]}
        self.assertEqual(visual["confidence"], "estimate")
        self.assertIn(visual["source"], source_ids)
        self.assertIn("dashboard1.png", next(
            source["title"] for source in SPEC["meta"]["sources"]
            if source["id"] == visual["source"]
        ))
        self.assertTrue(any("visual" in gap.lower() for gap in SPEC["meta"]["data_gaps"]))
        for section in (visual["dashboard"], visual["wheel_detail"],
                        visual["seat_detail"], visual["mirror_detail"]):
            self.assertEqual(section["confidence"], "estimate")
            self.assertIn(section["source"], source_ids)

    def test_seat_detail_contours_and_envelopes(self):
        detail = SPEC["visual_reconstruction"]["seat_detail"]["value"]
        self.assertEqual(detail["back_pivot"], [120, 0, -40])
        names = {part["name"] for part in detail["parts"]}
        self.assertTrue({"cushion_rounded", "back_rounded", "headrest_rounded",
                         "cushion_shell", "back_shell", "shoulder_panel"} <= names)
        for part in detail["parts"]:
            self.assertIn(part["metric"], SPEC["seat"])
            self.assertIn(part["material"], detail["materials"])
            self.assertTrue(all(0 < ratio <= 1 for ratio in part["size_ratio"]))
            self.assertGreater(part["radius"], 0)
            self.assertTrue(all(math.isfinite(value) for value in part["center"]))
            self.assertEqual(len(part["center"]), 3)
            contour = detail["contours"][part["contour"]]
            self.assertGreaterEqual(len(contour), 4)
            self.assertTrue(all(-0.5 <= v <= 0.5 for point in contour for v in point))
            area = sum(p[0] * q[1] - q[0] * p[1]
                       for p, q in zip(contour, contour[1:] + contour[:1]))
            self.assertGreater(area, 0, part["name"])
            rings = detail["rings"][part["rings"]]
            self.assertEqual([r[0] for r in rings], sorted(r[0] for r in rings))
            for ring in rings:
                self.assertEqual(len(ring), 5)
                self.assertTrue(all(math.isfinite(v) for v in ring))
                self.assertTrue(0 < ring[1] <= 1 and 0 < ring[2] <= 1)
            if "seam_ring" in part:
                self.assertTrue(0 <= part["seam_ring"] < len(rings))
        for seam in detail["panel_seams"]:
            self.assertGreaterEqual(len(seam["points"]), 2)
            self.assertTrue(all(len(p) == 3 and all(math.isfinite(v) for v in p)
                                for p in seam["points"]))

    def test_mirror_detail_stays_behind_unchanged_glass_plane(self):
        detail = SPEC["visual_reconstruction"]["mirror_detail"]["value"]
        for kind in ("exterior", "interior"):
            mirror = detail[kind]
            self.assertGreater(mirror["rim_width"], 0)
            self.assertGreater(mirror["glass_radius"], 0)
            self.assertGreater(mirror["housing_radius"], 0)
            self.assertGreater(mirror["mount_radius"], 0)
            self.assertTrue(all(v > 0 for v in mirror["mount_trim_size"]))
            outline = mirror["outline"]
            self.assertGreaterEqual(len(outline), 6)
            for axis in (0, 1):
                self.assertEqual(min(p[axis] for p in outline), -0.5)
                self.assertEqual(max(p[axis] for p in outline), 0.5)
            for name in ("shell_rings", "rim_rings"):
                rings = mirror[name]
                self.assertEqual([r[0] for r in rings], sorted(r[0] for r in rings))
                for ring in rings:
                    self.assertEqual(len(ring), 5)
                    self.assertTrue(all(math.isfinite(v) for v in ring))
                    self.assertLess(ring[0], 0)
                    self.assertTrue(0 < ring[1] <= 1.1 and 0 < ring[2] <= 1.1)
        self.assertTrue(any("headrest" in gap.lower() for gap in SPEC["meta"]["data_gaps"]))

    def test_body_sections_and_cutaway_geometry_are_valid(self):
        visual = SPEC["visual_reconstruction"]
        sections = visual["body_sections"]["value"]
        self.assertGreaterEqual(len(sections), 4)
        self.assertEqual([row[0] for row in sections], sorted(row[0] for row in sections))
        for row in sections:
            self.assertEqual(len(row), 6)
            self.assertTrue(all(math.isfinite(value) for value in row))
            self.assertGreater(row[4], row[5])
            self.assertGreater(row[3], row[2])
        self.assertGreater(visual["wheel_arch"]["radius_ratio"], 1)
        self.assertGreater(visual["body_panel_thickness_mm"], 0)
        self.assertLess(visual["body_side_inset_mm"], SPEC["vehicle"]["width_excl_mirrors"]["value"] / 2)
        self.assertLess(visual["roof_x_min"], visual["roof_x_max"])

    def test_glazing_and_trim_use_vehicle_frame_points(self):
        visual = SPEC["visual_reconstruction"]
        names = {panel["name"] for panel in visual["glazing"]}
        self.assertTrue({"windshield", "front_side", "rear_side", "rear_window"} <= names)
        for panel in visual["glazing"]:
            self.assertEqual(len(panel["points"]), 4)
            for point in panel["points"]:
                self.assertEqual(len(point), 3)
                self.assertTrue(all(math.isfinite(value) for value in point))
        stroke_names = {stroke["name"] for stroke in visual["strokes"]}
        self.assertTrue({
            "headlamp", "rear_lamp_upper", "front_side_glazing_trim",
            "front_door_seam", "rear_door_handle",
        } <= stroke_names)
        self.assertGreater(visual["glazing_surface_offset_mm"], 0)
        self.assertGreater(len(visual["dashboard"]["fascia"]), 2)
        self.assertGreater(len(visual["dashboard"]["console"]["parts"]), 2)
        self.assertEqual(len(visual["pillars"]), 4)
        for panel in visual["pillars"]:
            self.assertEqual(len(panel["points"]), 4)
            self.assertTrue(all(
                math.isfinite(value) for point in panel["points"] for value in point
            ))
        self.assertTrue(0 < visual["roof_glass_opacity"] <= 1)

    def test_refined_exterior_profiles_have_bounded_curvature_and_provenance(self):
        refinement = SPEC["visual_reconstruction"]["exterior_refinement"]
        self.assertEqual(refinement["confidence"], "estimate")
        self.assertEqual(refinement["source"], "local_gallery_visual")
        d = refinement["value"]
        for key in ("side_rows", "deck_rows", "end_rows", "glass_rows"):
            self.assertTrue(8 <= d[key] <= 40)
        self.assertTrue(10 <= d["hood_crown_mm"] <= 40)
        self.assertTrue(0 < d["fender_flare_mm"] <= 30)
        self.assertTrue(0 < d["arch_return_mm"] <= 50)
        profile = d["side_profile"]
        self.assertEqual([r[0] for r in profile], sorted(r[0] for r in profile))
        self.assertEqual((profile[0][0], profile[-1][0]), (0, 1))
        self.assertLess(min(r[1] for r in profile), -30)
        self.assertEqual(profile[-1][1], 0)
        roof = d["roof_sections"]
        self.assertEqual([r[0] for r in roof], sorted(r[0] for r in roof))
        self.assertTrue(all(600 <= w <= 780 and 1450 <= edge <= center <= 1635
                            for _, w, edge, center in roof))
        self.assertTrue(all(math.isfinite(v) for row in roof for v in row))
        for material in d["materials"].values():
            self.assertEqual(material["confidence"], "estimate")
            self.assertEqual(material["source"], refinement["source"])
            self.assertTrue(0 <= material["value"]["roughness"] <= 1)
        for part in d["panels"]:
            self.assertIn(part["material"], d["materials"])
            self.assertTrue(all(math.isfinite(v) for v in part["center"]))
            self.assertGreaterEqual(len(part["outline"]), 4)
            self.assertGreater(part["radius"], 0)
            area = sum(p[0] * q[1] - q[0] * p[1]
                       for p, q in zip(part["outline"], part["outline"][1:] + part["outline"][:1]))
            self.assertGreater(area, 0, part["name"])
            self.assertEqual([r[0] for r in part["rings"]], sorted(r[0] for r in part["rings"]))
            for ring in part["rings"]:
                self.assertEqual(len(ring), 5)
                self.assertTrue(all(math.isfinite(v) for v in ring))
                self.assertTrue(0 < ring[1] <= 1 and 0 < ring[2] <= 1)
        self.assertLessEqual(SPEC["visual_reconstruction"]["glazing_surface_offset_mm"], 1)


if __name__ == "__main__":
    unittest.main()
