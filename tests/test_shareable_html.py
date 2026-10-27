import json
import unittest
from html.parser import HTMLParser

from tools.build_shareable_html import ROOT, build_html, replace_once, script_json


class ExportDocument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = {}
        self.external_resources = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            self.current = attrs.get("id") or attrs.get("type", "bootstrap")
            self.scripts[self.current] = ""
        if tag in ("script", "link", "img", "iframe"):
            for key in ("src", "href"):
                if key in attrs:
                    self.external_resources.append(attrs[key])

    def handle_data(self, data):
        if self.current is not None:
            self.scripts[self.current] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.current = None


class ShareableHtml(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = build_html(ROOT)
        cls.document = ExportDocument()
        cls.document.feed(cls.content)

    def test_no_external_assets_required(self):
        self.assertEqual(self.document.external_resources, [])
        app = self.document.scripts["standalone-app"]
        self.assertNotIn("SPEC_URL", app)
        self.assertNotIn("SAMPLE_URL", app)
        self.assertIn('getElementById("embedded-spec")', app)
        self.assertIn('getElementById("embedded-demo")', app)

    def test_classic_bundle_needs_no_module_loader_or_data_urls(self):
        self.assertNotIn("importmap", self.document.scripts)
        self.assertNotIn("module", self.document.scripts)
        self.assertNotIn("data:text/javascript", self.content)
        app = self.document.scripts["standalone-app"]
        self.assertTrue(app.startswith("(() => {"))
        for symbol in ("WebGLRenderer", "OrbitControls", "GLTFExporter", "Ex60Scene"):
            self.assertIn(symbol, app)
        self.assertNotIn("from './", app)
        self.assertNotIn("import.meta", app)

    def test_embedded_data_exactly_matches_approved_inputs(self):
        for script, path in (
            ("embedded-spec", ROOT / "data" / "ex60_spec.json"),
            ("embedded-demo", ROOT / "data" / "timelines" / "sample_timeline.json"),
        ):
            self.assertEqual(json.loads(self.document.scripts[script]), json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(len(json.loads(self.document.scripts["embedded-spec"])["manikins"]), 9)

    def test_license_and_failure_message_included(self):
        self.assertIn("The MIT License", self.content)
        self.assertIn("three.js authors", self.content)
        self.assertIn("standalone-status", self.content)
        self.assertIn("unhandledrejection", self.content)
        self.assertIn("The interactive viewer has not started.", self.content)
        self.assertIn("Download</strong>", self.content)
        self.assertIn("15000", self.document.scripts["bootstrap"])

    def test_json_cannot_close_script_element(self):
        value = {"description": "</script><script>alert(1)</script>"}
        encoded = script_json(value)
        self.assertNotIn("<", encoded)
        self.assertEqual(json.loads(encoded), value)

    def test_template_changes_fail_explicitly(self):
        with self.assertRaises(ValueError):
            replace_once("missing", "template", "")
        with self.assertRaises(ValueError):
            replace_once("twice twice", "twice", "")


if __name__ == "__main__":
    unittest.main()
