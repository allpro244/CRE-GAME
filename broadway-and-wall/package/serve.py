#!/usr/bin/env python3
"""Static server for Broadway & Wall.

Why not `python3 -m http.server`? The map's tile archives (.pmtiles) are read
with HTTP Range requests — the browser asks for a few KB out of a 9 MB file.
Python's stock handler ignores Range and returns the whole archive with a 200,
which the tile reader rejects, so the city renders with no buildings. This
handler answers Range properly (206 + Content-Range) and is otherwise a plain
static server. Python 3.8+, no pip installs, no network.
"""
import http.server
import os
import re
import socket
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")

MIME = {
    ".pmtiles": "application/octet-stream",
    ".geojson": "application/geo+json",
    ".gz": "application/gzip",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".html": "text/html",
    ".svg": "image/svg+xml",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        # NOTE: deliberately no Content-Encoding for .gz — the app inflates
        # those itself after sniffing the gzip magic bytes.
        return MIME.get(ext, super().guess_type(path))

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()

        m = RANGE_RE.match(rng.strip())
        if not m:
            return super().send_head()

        size = os.path.getsize(path)
        start_s, end_s = m.group(1), m.group(2)
        if start_s == "":                      # suffix range: last N bytes
            if end_s == "":
                return super().send_head()
            length = min(int(end_s), size)
            start, end = size - length, size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
            end = min(end, size - 1)

        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Slice(f, end - start + 1)

    def log_message(self, *args):
        pass  # keep the console quiet; this is a game launcher


class _Slice:
    """File-like wrapper that yields at most `remaining` bytes to copyfile()."""

    def __init__(self, fh, remaining):
        self.fh, self.remaining = fh, remaining

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n is None or n < 0:
            n = self.remaining
        data = self.fh.read(min(n, self.remaining))
        self.remaining -= len(data)
        return data

    def close(self):
        self.fh.close()


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    if not os.path.exists(os.path.join(ROOT, "index.html")):
        print("! index.html not found next to serve.py — run this from the unzipped game folder.")
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    for attempt in range(20):
        try:
            httpd = Server(("127.0.0.1", port), Handler)
            break
        except OSError:
            port += 1
    else:
        print("! Could not find a free port in 8080-8099.")
        sys.exit(1)

    url = f"http://localhost:{port}/"
    print("\n  Broadway & Wall")
    print(f"  Serving at {url}")
    print("  Press Ctrl+C to stop.\n")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    socket.setdefaulttimeout(30)
    main()
