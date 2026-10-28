"""Render the remodel in isolated Chrome and verify JS/Python metric parity."""

import argparse
import functools
import hashlib
import http.server
import json
import shutil
import subprocess
import sys
import threading
import uuid
import zipfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ergo3d import geometry as G


class Result(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.text = ""

    def handle_starttag(self, tag, attrs):
        if tag == "pre" and dict(attrs).get("id") == "result":
            self.active = True

    def handle_data(self, data):
        if self.active:
            self.text += data

    def handle_endtag(self, tag):
        if tag == "pre":
            self.active = False


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Startup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = False
        self.depth = 0
        self.text = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id") == "standalone-status":
            self.hidden = "hidden" in attrs
        if tag == "div" and (self.depth or attrs.get("id") == "metrics"):
            self.depth += 1

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.text += data


def verify_exports():
    desktop = ROOT / "exports" / "EX60-3D-Viewer"
    count = 0
    inputs = [ROOT / "data" / "ex60_spec.json", ROOT / "README.md"]
    for folder, suffixes in (("ergo3d", {".py"}), ("viewer", {".js", ".css", ".html"}), ("config", {".json"})):
        inputs.extend(p for p in (ROOT / folder).iterdir() if p.suffix in suffixes)
    for source in inputs:
        target = desktop / source.relative_to(ROOT)
        assert source.read_bytes() == target.read_bytes(), str(target)
        count += 1
    archives = {}
    for name in ("EX60-3D-Viewer", "EX60-Teams-Web"):
        with zipfile.ZipFile(ROOT / "exports" / (name + ".zip")) as archive:
            assert archive.testzip() is None
            for entry in archive.infolist():
                assert "__pycache__" not in entry.filename
                assert archive.read(entry) == (ROOT / "exports" / Path(entry.filename)).read_bytes(), entry.filename
            archives[name] = len(archive.infolist())
    manifests = {}
    for folder in (ROOT / "exports", desktop, ROOT / "exports" / "EX60-Teams-Web"):
        lines = (folder / "SHA256SUMS.txt").read_text().splitlines()
        for line in lines:
            expected, path = line.split("  ", 1)
            assert hashlib.sha256((folder / Path(path)).read_bytes()).hexdigest() == expected, path
        manifests[folder.name] = len(lines)
    standalone = (ROOT / "exports" / "EX60-3D-Viewer.html").read_bytes()
    assert standalone == (desktop / "EX60-3D-Viewer.html").read_bytes()
    assert standalone == (ROOT / "exports" / "EX60-Teams-Web" / "index.html").read_bytes()
    return {"source_parity_files": count, "zip_entries": archives, "verified_checksums": manifests}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--exports", action="store_true", help="Also verify refreshed packages and their actual browser startup")
    parser.add_argument("--chrome", type=Path, default=Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    profile = ROOT / (".render-profile-" + uuid.uuid4().hex)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    report = {}
    try:
        for name, query in (("exterior", ""), ("dashboard", "dashboard"), ("top", "view=top"), ("seats", "view=seats"), ("upholstery", "view=upholstery")):
            result = subprocess.run([
                str(args.chrome), "--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
                "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                "--disable-extensions", "--disable-sync", "--hide-scrollbars",
                f"--user-data-dir={profile}", "--window-size=1600,1100", "--virtual-time-budget=12000",
                "--run-all-compositor-stages-before-draw", "--dump-dom",
                f"--screenshot={args.out.resolve() / (name + '.png')}",
                f"{base}/tests/visual_model.html?{query}&screenshot",
            ], capture_output=True, timeout=120)
            dom = result.stdout.decode("utf-8", errors="replace")
            (args.out / (name + ".html")).write_text(dom, encoding="utf-8")
            output = Result()
            output.feed(dom)
            if not output.text.startswith("{"):
                raise AssertionError(f"{name}: {output.text or result.stderr.decode(errors='replace')[-2000:]}")
            data = json.loads(output.text)
            assert data["status"] == "PASS", data
            report[name] = {key: value for key, value in data.items() if key not in ("metrics", "visibility_modes")}
            if name == "exterior":
                report["browser_metrics"] = data["metrics"]
                modes = data["visibility_modes"]
        spec = json.loads((ROOT / "data" / "ex60_spec.json").read_text())
        state = G.Adjustments.design(spec)
        metrics = {m: G.ergo_metrics(spec, state, m) for m in spec["manikins"]}
        max_error = 0
        for manikin, values in metrics.items():
            for key, value in values.items():
                error = abs(value - report["browser_metrics"][manikin][key])
                max_error = max(max_error, error)
                assert error < 1e-8, (manikin, key, error)
        for mode, values in modes.items():
            spec["displays"]["driver"]["visibility_mode"] = mode
            for manikin, value in values.items():
                assert abs(value - G.cluster_sightline_margin(spec, state, manikin)) < 1e-8
        baseline_path = args.out / "baseline-metrics.json"
        if baseline_path.exists():
            baseline = json.loads(baseline_path.read_text())
            delta = {}
            for name, values in metrics.items():
                old = baseline[name]["cluster_sightline_margin_mm"]
                new = values["cluster_sightline_margin_mm"]
                delta[name] = {"before_mm": old, "after_mm": new, "delta_mm": new - old}
                for key, value in values.items():
                    if key != "cluster_sightline_margin_mm":
                        assert abs(value - baseline[name][key]) < 1e-10, (name, key)
            report["dim_delta"] = delta
            report["other_metric_deltas"] = 0
        report["max_python_js_error"] = max_error
        if args.exports:
            report["exports"] = verify_exports()
            for name, path in (
                ("source-app", "/viewer/index.html"),
                ("standalone-app", "/exports/EX60-3D-Viewer.html"),
                ("desktop-app", "/exports/EX60-3D-Viewer/viewer/index.html"),
                ("teams-app", "/exports/EX60-Teams-Web/index.html"),
            ):
                result = subprocess.run([
                    str(args.chrome), "--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
                    "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                    "--disable-extensions", "--disable-sync", f"--user-data-dir={profile}",
                    "--window-size=1280,900", "--virtual-time-budget=2000", "--dump-dom",
                    f"--screenshot={args.out.resolve() / (name + '.png')}", base + path,
                ], capture_output=True, timeout=120)
                dom = result.stdout.decode("utf-8", errors="replace")
                (args.out / (name + ".html")).write_text(dom, encoding="utf-8")
                startup = Startup()
                startup.feed(dom)
                assert "Cluster sightline margin" in startup.text and "8.4" in startup.text, (name, startup.text)
                if name in ("standalone-app", "teams-app"):
                    assert startup.hidden, (name, "Standalone did not complete startup")
                report[name] = "PASS (actual metrics panel: DIM 8.4 mm)"
        (args.out / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({k: v for k, v in report.items() if k != "browser_metrics"}, indent=2))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        if profile.exists():
            shutil.rmtree(profile)


if __name__ == "__main__":
    main()
