#!/usr/bin/env python3
"""Download one OSM bulk extract and retain its URL, date and checksum."""
import argparse
import hashlib
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url')
parser.add_argument('destination', type=Path)
parser.add_argument('--max-gb', type=float, default=1)
args = parser.parse_args()
if not args.url.startswith('https://'):
    parser.error('Use an HTTPS source URL')
args.destination.parent.mkdir(parents=True, exist_ok=True)
partial = args.destination.with_suffix(args.destination.suffix + '.part')
digest, count, last = hashlib.sha256(), 0, time.monotonic()
try:
    request = urllib.request.Request(args.url, headers={'User-Agent': 'BorderClosuresAtlas-research/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as file:
        source_headers = {key: response.headers.get(key) for key in ('Last-Modified', 'ETag', 'Content-Length')}
        if int(source_headers.get('Content-Length') or 0) > args.max_gb * 1024 ** 3:
            raise ValueError('Extract exceeds the selected size limit')
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > args.max_gb * 1024 ** 3:
                raise ValueError('Extract exceeds the selected size limit')
            file.write(chunk)
            digest.update(chunk)
            if time.monotonic() - last >= 10:
                print(f'Downloaded {count / 1024 ** 2:.0f} MiB', flush=True)
                last = time.monotonic()
    partial.replace(args.destination)
    manifest = {'url': args.url, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                'bytes': count, 'sha256': digest.hexdigest(), 'http_headers': source_headers}
    args.destination.with_suffix('.download.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))
except Exception:
    partial.unlink(missing_ok=True)
    raise
