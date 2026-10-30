"""Build a single-file viewer that runs directly from a local/shared folder."""

import argparse
import html
import json
import os
import platform
import shutil
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional, Sequence


ROOT = Path(__file__).resolve().parents[1]

@contextmanager
def project_build_directory():
    stage = ROOT / "tools" / (".export-build-" + uuid.uuid4().hex)
    stage.mkdir()
    try:
        yield stage
    finally:
        shutil.rmtree(stage)


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise ValueError(f"Expected exactly one occurrence of export template: {old!r}")
    return text.replace(old, new, 1)


def script_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c")


def bundle_app(viewer: Path, app: str) -> str:
    binary = os.environ.get("ESBUILD_BINARY_PATH") or shutil.which("esbuild")
    if not binary:
        system = {"Windows": "win32", "Linux": "linux", "Darwin": "darwin"}.get(platform.system())
        arch = {"AMD64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
        package = ROOT / "tools" / "node_modules" / "@esbuild" / f"{system}-{arch}"
        executable = package / ("esbuild.exe" if system == "win32" else "bin/esbuild")
        if executable.is_file():
            binary = str(executable)
    if not binary:
        raise RuntimeError(
            "esbuild is required only to rebuild the HTML. Run 'npm --prefix tools install', "
            "install esbuild on PATH, or set ESBUILD_BINARY_PATH to its native executable."
        )

    # Resolve only the vendored modules; never fetch application code or data.
    with project_build_directory() as stage:
        three = stage / "node_modules" / "three"
        three.mkdir(parents=True)
        shutil.copyfile(viewer / "vendor" / "three.module.js", three / "index.js")
        (three / "package.json").write_text('{"main":"index.js"}', encoding="utf-8")
        for addon in ("controls/OrbitControls.js", "exporters/GLTFExporter.js",
                      "loaders/GLTFLoader.js", "utils/BufferGeometryUtils.js"):
            target = three / "addons" / addon
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(viewer / "vendor" / "addons" / addon, target)
        for name in ("kinematics.js", "model.js", "imported-car.js"):
            shutil.copyfile(viewer / name, stage / name)
        (stage / "app.js").write_text(app, encoding="utf-8")
        try:
            result = subprocess.run([
                binary, str(stage / "app.js"), "--bundle", "--format=iife", "--target=es2020",
                "--charset=utf8", "--legal-comments=inline", "--log-level=warning",
            ], capture_output=True, check=True, encoding="utf-8")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
            return result.stdout
        except subprocess.CalledProcessError as error:
            raise RuntimeError(f"Viewer bundling failed: {error.stderr}") from error


def build_html(root: Path) -> str:
    viewer = root / "viewer"
    app = (viewer / "app.js").read_text(encoding="utf-8")
    app = replace_once(app, "const SPEC_URL = '../data/ex60_spec.json';", "")
    app = replace_once(app, "const SAMPLE_URL = '../data/timelines/sample_timeline.json';", "")
    app = replace_once(
        app, "const spec = await (await fetch(SPEC_URL)).json();",
        "const spec = JSON.parse(document.getElementById('embedded-spec').textContent);",
    )
    app = replace_once(
        app,
        """    const r = await fetch(SAMPLE_URL);
    if (!r.ok) throw new Error(`${SAMPLE_URL}: HTTP ${r.status}. Run the "ergo3d: sync sample logs" task first.`);
    loadTimeline(await r.json(), 'sample_timeline.json');""",
        """    loadTimeline(JSON.parse(document.getElementById('embedded-demo').textContent), 'sample_timeline.json');""",
    )
    app += "\nwindow.ergoStandaloneReady = true;\ndocument.getElementById('standalone-status').hidden = true;\n"
    app = bundle_app(viewer, app).replace("</script", "<\\/script")

    document = (viewer / "index.html").read_text(encoding="utf-8")
    css = (viewer / "style.css").read_text(encoding="utf-8")
    document = replace_once(document, '<link rel="stylesheet" href="style.css" />', f"<style>{css}</style>")
    old_map = """  <script type="importmap">
    { "imports": { "three": "./vendor/three.module.js", "three/addons/": "./vendor/addons/" } }
  </script>"""
    document = replace_once(document, old_map, "")
    spec = json.loads((root / "data" / "ex60_spec.json").read_text(encoding="utf-8"))
    demo = json.loads((root / "data" / "timelines" / "sample_timeline.json").read_text(encoding="utf-8"))
    if demo.get("format") != "ergo3d-timeline/1":
        raise ValueError("The synthetic demo must be an ergo3d-timeline/1 timeline")
    license_text = html.escape((viewer / "vendor" / "THREE_LICENSE.txt").read_text(encoding="utf-8"))
    document = replace_once(document, "</footer>", f"""
      <details><summary>Single-file sharing / license</summary>
        <p>This file contains the viewer, model spec, nine illustrative body profiles and a synthetic demo.
        Open it directly in a modern WebGL-capable browser. No server, Python or internet is needed.</p>
        <p>For OneDrive, download the HTML or open it from a synced folder using your browser.
        OneDrive/SharePoint web previews may block scripts; they do not host this application.</p>
        <p>Real logs, private reports and CAD are not included. Local file imports remain in your browser.
        Review any pose or GLB exports before sharing. All body profiles and interior geometry remain
        illustrative estimates, not safety certification or validated anthropometry.</p>
        <pre style="white-space:pre-wrap">{license_text}</pre>
      </details>
    </footer>""")
    document = replace_once(document, "<body>", """<body>
  <div id="standalone-status" role="alert" style="position:fixed;bottom:0;left:0;right:0;z-index:100;background:#59271e;color:white;padding:12px;max-height:50vh;overflow:auto">
    <strong id="standalone-message">The interactive viewer has not started.</strong>
    <ol>
      <li>In Teams / SharePoint / OneDrive: use <strong>Download</strong>, then open the saved HTML
      with Edge, Chrome or Firefox. The file preview is not an interactive website.</li>
      <li>From a shared folder: save a local copy, then use <strong>Open with</strong> your browser.</li>
      <li>For a no-download web link: ask the site owner to host this HTML on an approved website
      that permits JavaScript and WebGL. A SharePoint file-sharing link does not do this.</li>
    </ol>
    <span id="standalone-detail">This viewer cannot override your organization's preview or security policies.</span>
  </div>
  <noscript>This interactive 3D viewer requires JavaScript. Enable it and reload this local HTML file.</noscript>
  <script>
    window.ergoStandaloneReady = false;
    const showViewerError = (message) => {
      const status = document.getElementById('standalone-status');
      status.hidden = false;
      document.getElementById('standalone-message').textContent = 'The 3D viewer could not start or encountered an error.';
      document.getElementById('standalone-detail').textContent = 'Technical detail: ' + message;
    };
    window.addEventListener('error', (event) => showViewerError(event.message || 'A viewer resource failed'));
    window.addEventListener('unhandledrejection', (event) => showViewerError(String(event.reason)));
    document.getElementById('standalone-message').textContent = 'Starting the embedded 3D viewer...';
    setTimeout(() => {
      if (!window.ergoStandaloneReady) {
        showViewerError('Startup did not finish. Scripts or WebGL may be blocked; use the download/open instructions above or contact the site owner.');
      }
    }, 15000);
  </script>""")
    document = replace_once(
        document, '<script type="module" src="app.js"></script>',
        '<script id="embedded-spec" type="application/json">' + script_json(spec) + "</script>\n"
        '<script id="embedded-demo" type="application/json">' + script_json(demo) + "</script>\n"
        '<script id="standalone-app">' + app + "</script>",
    )
    return document


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "exports" / "EX60-3D-Viewer.html")
    args = parser.parse_args(argv)
    content = build_html(ROOT)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(content, encoding="utf-8")
    print(f"Single-file viewer: {args.out.resolve()} ({args.out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
