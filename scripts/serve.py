"""Optional local preview of the standalone HTML site. Python standard library only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
from functools import partial

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8080)
parser.add_argument('--host', default='0.0.0.0')
parser.add_argument('--directory', default=str(Path(__file__).resolve().parent.parent))
args = parser.parse_args()
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(args.directory).resolve()))
server = ThreadingHTTPServer((args.host, args.port), handler)
print(f'HTML preview listening on port {args.port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
