#!/usr/bin/env python3
"""Serve the static reader locally; accepts the preview runner's port flags."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, default=3000)
parser.add_argument('--strictPort', action='store_true')
args = parser.parse_args()
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parents[1] / 'site'))
with ThreadingHTTPServer((args.host, args.port), handler) as server:
    print(f'Reader available at http://{args.host}:{args.port}', flush=True)
    server.serve_forever()
