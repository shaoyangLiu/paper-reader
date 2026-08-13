#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Paper Reader - minimal local server (Python stdlib only, zero pip dependencies).

Serves:
  * the reader web app (reader.html / app.js / styles.css / vendor/*)
  * the Literature folder (paper HTML + PDF)
  * annotation sidecar files (.anno.json) saved next to each paper

Run:  python server.py     (or double-click start-reader.bat)
Then open the printed http://localhost:PORT address.

Security note: every file served from the Literature folder is confined to
LIT_ROOT via a realpath prefix check, so path-traversal requests are rejected.
"""

import os
import sys
import json
import shutil
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Folder that holds your papers (each subfolder = one paper: PDF + HTML).
LIT_ROOT = r"C:\Users\z3450390\OneDrive - UNSW\Desktop\OneDrive Sync\Literature"

# Port for the local server.
PORT = 8731

APP_DIR = os.path.dirname(os.path.abspath(__file__))

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def safe_join(root, *parts):
    """Join paths and ensure the result stays inside `root`. Returns None if not."""
    root = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root, *parts))
    if target == root or target.startswith(root + os.sep):
        return target
    return None


# ---------------------------------------------------------------------------
# Paper library
# ---------------------------------------------------------------------------
def list_papers():
    papers = []
    if not os.path.isdir(LIT_ROOT):
        return papers
    for entry in sorted(os.listdir(LIT_ROOT)):
        folder = os.path.join(LIT_ROOT, entry)
        if not os.path.isdir(folder):
            continue
        htmls, pdfs = [], []
        for f in sorted(os.listdir(folder)):
            low = f.lower()
            if low.endswith(".html"):
                htmls.append(f)
            elif low.endswith(".pdf"):
                pdfs.append(f)
        if not (htmls or pdfs):
            continue
        papers.append({
            "folder": entry,
            "title": entry,
            "html": htmls,
            "pdf": pdfs,
        })
    return papers


def anno_path(folder, html_file):
    base = os.path.splitext(html_file)[0]
    return os.path.join(LIT_ROOT, folder, base + ".anno.json")


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "PaperReader/1.0"

    # ---- helpers ----
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        ext = os.path.splitext(path)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            self._send(404, json.dumps({"error": "not found"}))
            return
        self._send(200, data, ctype)

    def _json(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    # ---- routing ----
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/reader.html"):
            self._send_file(os.path.join(APP_DIR, "reader.html"))
            return

        if path.startswith("/static/"):
            rel = urllib.parse.unquote(path[len("/static/"):])
            fp = safe_join(APP_DIR, *rel.split("/"))
            if fp and os.path.isfile(fp):
                self._send_file(fp)
            else:
                self._send(404, json.dumps({"error": "not found"}))
            return

        if path == "/api/papers":
            self._send(200, json.dumps(list_papers(), ensure_ascii=False))
            return

        if path == "/api/paper":
            folder = qs.get("folder", [""])[0]
            file = qs.get("file", [""])[0]
            fp = safe_join(LIT_ROOT, folder, file)
            if fp and os.path.isfile(fp):
                self._send_file(fp)
            else:
                self._send(404, json.dumps({"error": "not found"}))
            return

        if path == "/api/annotations":
            folder = qs.get("folder", [""])[0]
            file = qs.get("file", [""])[0]
            fp = anno_path(folder, file)
            if os.path.isfile(fp):
                self._send_file(fp)
            else:
                self._send(200, json.dumps({"annotations": []}, ensure_ascii=False))
            return

        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/annotations":
            self._send(404, json.dumps({"error": "not found"}))
            return
        data = self._json()
        folder = data.get("folder", "")
        file = data.get("html", data.get("file", ""))
        annotations = data.get("annotations", [])
        if not folder or not file:
            self._send(400, json.dumps({"error": "missing folder/file"}))
            return
        fp = anno_path(folder, file)
        if not fp or not fp.startswith(os.path.realpath(LIT_ROOT) + os.sep):
            self._send(400, json.dumps({"error": "invalid path"}))
            return
        # Atomic-ish write: temp then rename.
        tmp = fp + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"annotations": annotations}, fh, ensure_ascii=False, indent=2)
            shutil.move(tmp, fp)
        except OSError as e:
            self._send(500, json.dumps({"error": str(e)}))
            return
        self._send(200, json.dumps({"ok": True}))

    # Quieter logs
    def log_message(self, fmt, *args):
        sys.stderr.write("[reader] " + (fmt % args) + "\n")


def main():
    global PORT
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://localhost:%d/" % PORT
    print("Paper Reader running at:", url)
    print("Literature folder:", LIT_ROOT)
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
