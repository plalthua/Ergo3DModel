"""Command line entry point: ``python -m ergo3d <command>``."""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import webbrowser
from pathlib import Path

from . import report as rep
from .geometry import Adjustments, ergo_flags, ergo_metrics
from .log_sync import build_timeline, extract_channels, load_json, merge
from .sample_logs import generate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SPEC = os.path.join(ROOT, "data", "ex60_spec.json")
DEFAULT_MAPPING = os.path.join(ROOT, "config", "signal_mapping.json")


def _parse_log_arg(arg: str):
    """'path[@offset_s]' -> (path, offset)."""
    if "@" in arg and os.path.exists(arg.rsplit("@", 1)[0]):
        p, o = arg.rsplit("@", 1)
        return p, float(o)
    return arg, 0.0


def cmd_sync(a) -> int:
    spec, mapping = load_json(a.spec), load_json(a.mapping)
    logs = [_parse_log_arg(x) for x in a.logs]
    sources = []
    for path, off in logs:
        ch = extract_channels(path, mapping, off)
        print(f"  {os.path.basename(path)}: {', '.join(sorted(ch)) or 'no mapped channels'}")
        sources.append(ch)
    tl = build_timeline(merge(sources), spec, a.rate, a.start, a.end, a.align_event, a.align_threshold,
                        [p for p, _ in logs])
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(tl, f, separators=(",", ":"))
    print(f"Timeline: {len(tl['t'])} frames @ {a.rate} Hz, {len(tl['channels'])} channels -> {a.out}")
    if tl["missing_channels"]:
        print(f"  Missing (design value used): {', '.join(tl['missing_channels'])}")
    return 0


def cmd_report(a) -> int:
    spec, tl = load_json(a.spec), load_json(a.timeline)
    rows = rep.evaluate(spec, tl, a.manikin)
    base = a.out or os.path.join(ROOT, "reports", os.path.splitext(os.path.basename(a.timeline))[0] + f"_{a.manikin}")
    os.makedirs(os.path.dirname(base), exist_ok=True)
    rep.write_csv(base + ".csv", rows)
    summary = rep.summarize(spec, tl, rows, a.manikin)
    with open(base + "_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    print(f"Wrote {base}.csv and {base}_summary.json")
    return 0


def cmd_design(a) -> int:
    spec = load_json(a.spec)
    for mk in spec["manikins"]:
        m = ergo_metrics(spec, Adjustments.design(spec), mk)
        f = ergo_flags(spec, m)
        print(f"[{mk}]")
        for k, v in m.items():
            print(f"  {k:36s} {v:9.1f}")
        print("  violations:", ", ".join(k for k, v in f.items() if v) or "none")
    return 0


def cmd_sample(a) -> int:
    for p in generate(a.out_dir, a.duration):
        print("wrote", p)
    return 0


def cmd_serve(a) -> int:
    from .mdf_import import MdfImporter
    from .nuc_export import ShareConnector, ConnectorError, read_config
    from .nuc_server import ViewerHandler

    connector = None
    if a.nuc_config:
        try:
            config_path = Path(a.nuc_config).resolve()
            local = (Path(ROOT) / "data" / "logs").resolve()
            if local not in config_path.parents:
                raise ConnectorError("Keep the private connector config under data\\logs\\.")
            connector = ShareConnector(read_config(str(config_path)), local / "nuc-sessions")
        except (OSError, ValueError) as exc:
            print(f"NUC connector configuration failed: {exc}", file=sys.stderr)
            return 2
    handler = functools.partial(ViewerHandler, directory=ROOT, connector=connector,
                                importer=MdfImporter(ROOT, a.spec))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    url = f"http://127.0.0.1:{a.port}/viewer/index.html"
    print(f"Serving {ROOT} -> {url}  (Ctrl+C to stop)")
    if a.open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        if connector:
            connector.close()
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ergo3d", description="EX60 ergonomic 3D model tools")
    p.add_argument("--spec", default=DEFAULT_SPEC, help="vehicle spec JSON")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sync", help="map + merge + resample test logs into a viewer timeline")
    s.add_argument("logs", nargs="+", help="CSV/MF4 logs; append @<seconds> to shift a file's clock")
    s.add_argument("-o", "--out", default=os.path.join(ROOT, "data", "timelines", "timeline.json"))
    s.add_argument("--mapping", default=DEFAULT_MAPPING)
    s.add_argument("--rate", type=float, default=10.0, help="output rate in Hz")
    s.add_argument("--start", type=float, help="start time (s, relative to time zero)")
    s.add_argument("--end", type=float, help="end time (s, relative to time zero)")
    s.add_argument("--align-event", help="canonical channel whose first change defines t=0")
    s.add_argument("--align-threshold", type=float, default=1.0)
    s.set_defaults(fn=cmd_sync)

    r = sub.add_parser("report", help="per-frame ergo metrics for a timeline")
    r.add_argument("timeline")
    r.add_argument("--manikin", default="p50_male")
    r.add_argument("-o", "--out", help="output path without extension")
    r.set_defaults(fn=cmd_report)

    d = sub.add_parser("design", help="print ergo metrics at the design position for all manikins")
    d.set_defaults(fn=cmd_design)

    g = sub.add_parser("sample", help="generate synthetic test-drive logs")
    g.add_argument("--out-dir", default=os.path.join(ROOT, "data", "sample_logs"))
    g.add_argument("--duration", type=float, default=60.0)
    g.set_defaults(fn=cmd_sample)

    v = sub.add_parser("serve", help="serve the 3D viewer on localhost")
    v.add_argument("--port", type=int, default=8060)
    v.add_argument("--open", action="store_true", help="open the browser")
    v.add_argument("--nuc-config", help="private share-drive JSON configuration under data\\logs\\")
    v.set_defaults(fn=cmd_serve)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
