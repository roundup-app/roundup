#!/usr/bin/env python3
"""A refusing HTTP proxy: logs every CONNECT or proxied request to LOG_DIR/proxy.jsonl, answers 403.

  python3 proxy.py PORT LOG_DIR

Set as HTTPS_PROXY/HTTP_PROXY with NO_PROXY=127.0.0.1,localhost, so any traffic that is not to
the local mock is caught here and never leaves the machine.
"""
import json
import socketserver
import sys
import time

PORT, LOG_DIR = int(sys.argv[1]), sys.argv[2]


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline(4096).decode(errors="replace").strip()
        with open(f"{LOG_DIR}/proxy.jsonl", "a") as out:
            out.write(json.dumps({"t": round(time.time(), 3), "request": line}) + "\n")
        self.wfile.write(
            b"HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        )


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler).serve_forever()
