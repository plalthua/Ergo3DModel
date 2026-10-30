"""Same-origin, loopback-only API for the optional share-drive connector."""

import json
from http.server import SimpleHTTPRequestHandler
from urllib.parse import unquote, urlsplit

from .nuc_export import ConnectorError


class ViewerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, connector=None, importer=None, **kwargs):
        self.connector = connector
        self.importer = importer
        super().__init__(*args, **kwargs)

    def _local(self):
        port = self.server.server_port
        host = self.headers.get("Host", "")
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            self.send_error(403, "Loopback Host required")
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin != f"http://{host}":
            self.send_error(403, "Same-origin requests required")
            return False
        if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            self.send_error(403, "Cross-site requests denied")
            return False
        return True

    def _json(self, status, data):
        encoded = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _private(self):
        path = unquote(urlsplit(self.path).path).replace("\\", "/").lower()
        parts = [part for part in path.split("/") if part not in ("", ".")]
        normalized = [part.rstrip(" .") for part in parts]
        return (".." in parts or ":" in path
                or normalized[:2] == ["data", "logs"])

    def do_GET(self):
        if not self._local():
            return
        if self.path == "/api/nuc/status":
            self._json(200, {
                "configured": self.connector is not None,
                "message": ("Share drive configured. Preview checks Windows access and the recording index."
                            if self.connector else
                            "Share drive not configured. Restart with serve --nuc-config <local-config.json>."),
            })
        elif self._private():
            self.send_error(403, "Private log files are not served")
        else:
            super().do_GET()

    def do_HEAD(self):
        if not self._local():
            return
        if self._private() or self.path.startswith("/api/"):
            self.send_error(403)
        else:
            super().do_HEAD()

    def do_POST(self):
        if not self._local():
            return
        if self.headers.get("Origin") != f"http://{self.headers.get('Host')}":
            self._json(403, {"error": "A same-origin browser request is required."})
            return
        mdf_request = self.path in ("/api/nuc/mdf/begin", "/api/nuc/mdf/convert")
        if not mdf_request and self.path not in ("/api/nuc/preview", "/api/nuc/download"):
            self._json(404, {"error": "Unknown connector endpoint."})
            return
        if (self.importer if mdf_request else self.connector) is None:
            self._json(503, {"error": "Local MDF importer is not available." if mdf_request
                                    else "Share-drive connector is not configured."})
            return
        try:
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ConnectorError("Content-Type must be application/json.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 4096 or self.headers.get("Transfer-Encoding"):
                raise ConnectorError("Request body must be between 1 and 4096 bytes.")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ConnectorError("Request must be a JSON object.")
            if self.path == "/api/nuc/mdf/begin":
                result = self.importer.begin()
            elif self.path == "/api/nuc/mdf/convert":
                result = self.importer.convert(data.get("session_id"), data.get("mapping_verified"))
                for error in result["errors"]:
                    self.log_error("MDF conversion failed for %s: %s", error["name"], error["error"])
            elif self.path.endswith("/preview"):
                result = self.connector.preview(data)
            else:
                result = self.connector.download(data.get("plan_id"))
            self._json(200, result)
        except (ValueError, UnicodeDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except OSError:
            self.log_error("Local connector storage operation failed")
            self._json(500, {"error": "Local storage operation failed. Check server console and disk permissions."})
