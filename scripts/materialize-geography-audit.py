#!/usr/bin/env python3
"""Restore byte-exact geography and status JSON from verified gzip chunks.

Use --pack after intentional edits, before --bind-manifest. The default never
overwrites a changed local JSON file. Stored payloads, not hydrated JSON, belong
in Git; original source/review hashes remain hashes of the uncompressed bytes.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_DIR = Path('source/geography-audit-payloads')
MANIFEST = PAYLOAD_DIR/'manifest.json'
CHUNK_BYTES = 160000
TARGETS = {
    'crossing-locations': 'source/crossings/locations.json',
    'crossing-scope-review': 'source/crossings/scope-review.json',
    'audit-decisions': 'research/geography-audit-2026-10-29/reconciled-decisions.json',
    'review-americas-europe': 'research/geography-audit-2026-10-29/reconciliation-americas-europe.json',
    'review-africa-middle-east': 'research/geography-audit-2026-10-29/reconciliation-africa-middle-east.json',
    'status-review': 'source/border-status-review.json',
}
CHUNK_NAME = re.compile(r'^(?:'+ '|'.join(TARGETS) + r')-[0-9a-f]{16}\.json\.gz\.part[0-9]{3}$')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_replace(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_manifest(root, allow_new_targets=False):
    manifest = json.loads((root/MANIFEST).read_text())
    if manifest.get('format') != 'geography-audit-gzip-chunks' or manifest.get('version') != 1:
        raise ValueError('Unknown geography payload format')
    files = manifest.get('files', [])
    paths = {f['path'] for f in files}
    if len(paths) != len(files) or (not paths <= set(TARGETS.values()) if allow_new_targets else paths != set(TARGETS.values())):
        raise ValueError('Payload manifest must name exactly the canonical targets')
    seen = set()
    for item in files:
        owner = next(key for key, value in TARGETS.items() if value == item['path'])
        if not item.get('chunks'):
            raise ValueError('Payload has no chunks: '+item['path'])
        for chunk in item['chunks']:
            name = chunk['file']
            if not CHUNK_NAME.fullmatch(name) or not name.startswith(owner+'-') or name in seen:
                raise ValueError('Invalid or duplicate owned chunk name: '+name)
            if not 0 < chunk['bytes'] <= CHUNK_BYTES:
                raise ValueError('Invalid chunk size: '+name)
            seen.add(name)
    return manifest


def pack(root=ROOT):
    old = read_manifest(root, allow_new_targets=True) if (root/MANIFEST).exists() else None
    # Read and validate every target before changing any stored payload.
    originals = {name: (root/target).read_bytes() for name, target in TARGETS.items()}
    for raw in originals.values():
        json.loads(raw)
    files = []
    for name, target in TARGETS.items():
        raw = originals[name]
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        # RFC 1952 OS byte: portable unknown OS, rather than host-specific zlib metadata.
        compressed = compressed[:9]+b'\xff'+compressed[10:]
        compressed_hash = digest(compressed)
        chunks = []
        for index, start in enumerate(range(0, len(compressed), CHUNK_BYTES)):
            data = compressed[start:start+CHUNK_BYTES]
            filename = f'{name}-{compressed_hash[:16]}.json.gz.part{index:03d}'
            atomic_replace(root/PAYLOAD_DIR/filename, data)
            chunks.append({'file': filename, 'bytes': len(data), 'sha256': digest(data)})
        files.append({'path': target, 'bytes': len(raw), 'sha256': digest(raw),
                      'gzip_bytes': len(compressed), 'gzip_sha256': compressed_hash,
                      'chunks': chunks})
    manifest = {'format': 'geography-audit-gzip-chunks', 'version': 1,
                'chunk_max_bytes': CHUNK_BYTES, 'files': files}
    atomic_replace(root/MANIFEST, (json.dumps(manifest, indent=2)+'\n').encode())
    # Only old manifest-owned files may be removed; unrelated files are untouched.
    current = {c['file'] for item in files for c in item['chunks']}
    if old:
        for item in old['files']:
            for chunk in item['chunks']:
                if chunk['file'] not in current:
                    (root/PAYLOAD_DIR/chunk['file']).unlink(missing_ok=True)
    return manifest


def materialize(root=ROOT):
    manifest = read_manifest(root)
    verified = []
    for item in manifest['files']:
        parts = []
        for chunk in item['chunks']:
            data = (root/PAYLOAD_DIR/chunk['file']).read_bytes()
            if len(data) != chunk['bytes'] or digest(data) != chunk['sha256']:
                raise ValueError('Geography chunk integrity failure: '+chunk['file'])
            parts.append(data)
        compressed = b''.join(parts)
        if len(compressed) != item['gzip_bytes'] or digest(compressed) != item['gzip_sha256']:
            raise ValueError('Compressed payload integrity failure: '+item['path'])
        raw = gzip.decompress(compressed)
        if len(raw) != item['bytes'] or digest(raw) != item['sha256']:
            raise ValueError('Uncompressed payload integrity failure: '+item['path'])
        target = root/item['path']
        if target.exists() and target.read_bytes() != raw:
            raise ValueError('Local geography differs from the packed source: '+item['path']+
                             '. Review intentional edits, run materialize-geography-audit.py --pack, then bind the release.')
        verified.append((target, raw))
    # Verify the complete set before writing; exclusive links never clobber local changes.
    created = 0
    for target, raw in verified:
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw)
        try:
            try:
                os.link(temporary, target)
                created += 1
            except FileExistsError:
                if target.read_bytes() != raw:
                    raise ValueError('A local geography file changed during restoration: '+str(target))
        finally:
            temporary.unlink(missing_ok=True)
    return {'verified_files': len(verified), 'created_files': created,
            'uncompressed_bytes': sum(len(raw) for _, raw in verified),
            'chunks': sum(len(item['chunks']) for item in manifest['files'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', action='store_true', help='Pack intentional canonical JSON edits into deterministic chunks')
    parser.add_argument('--root', type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.pack:
        pack(args.root)
    print(json.dumps({'geography_payloads': materialize(args.root), 'packed': args.pack}))


if __name__ == '__main__':
    main()
