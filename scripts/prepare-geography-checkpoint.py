#!/usr/bin/env python3
"""Stage a public checkpoint plus a separate binary-blob upload sidecar.

Upload every entry in OUTPUT.blobs.json with GitHub create_blob first, checking
its expected git_sha. OUTPUT then contains tree entries referencing those blobs.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
AUDIT = Path('research/geography-audit-2026-10-29')
SOURCE_FILES = [
    '.github/workflows/pages.yml', '.gitignore', 'dist/core.js', 'dist/index.html', 'source/crossings/README.md',
    'source/crossings/locations.json', 'source/crossings/scope-review.json',
    'source/current-release-manifest.json',
    'scripts/geography-audit-progress.cjs', 'scripts/apply-geography-audit.cjs',
    'scripts/verify-geography-audit.cjs', 'scripts/prepare-geography-checkpoint.py',
    'scripts/build-crossing-geography.cjs', 'scripts/verify-crossing-map.cjs',
    'scripts/build_geography_audit_report.py', 'scripts/build-gis-downloads.py',
    'scripts/verify-gis-downloads.py', 'scripts/analysis-template.html',
    'scripts/materialize-geography-audit.py', 'scripts/prepare-release-workbook.py',
]
AUDIT_FILES = ['README.md', 'audit-plan.json', 'baseline-map-bindings.json',
               'reconciled-decisions.json', 'integration-receipt.json',
               'new-site-metadata-corrections.json']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--previous-hashes', type=Path)
    args = parser.parse_args()
    subprocess.run([sys.executable, str(ROOT/'scripts/materialize-geography-audit.py')], check=True,
                   stdout=subprocess.DEVNULL)
    payload_manifest_path = Path('source/geography-audit-payloads/manifest.json')
    payload_manifest = json.loads((ROOT/payload_manifest_path).read_text())
    materialized = {Path(item['path']) for item in payload_manifest['files']}
    binary_paths = {payload_manifest_path.parent/chunk['file']
                    for item in payload_manifest['files'] for chunk in item['chunks']}
    paths = {p.relative_to(ROOT) for part in ['pass-a', 'pass-b']
             for p in (ROOT/AUDIT/part).glob('*.json')}
    review_count = len(paths)
    contents = {p: (ROOT/p).read_text() for p in paths}
    # Reconciliation pins exact independent-pass bytes; reject a racing rewrite.
    decisions = json.loads((ROOT/AUDIT/'reconciled-decisions.json').read_text())
    for decision in decisions['decisions']:
        for ref in decision['audit_passes']:
            actual = hashlib.sha256(contents[Path(ref['path'])].encode()).hexdigest()
            if actual != ref['sha256']:
                raise ValueError('Reconcile changed evidence before checkpoint: '+ref['path'])
    for text in list(contents.values()):
        record = json.loads(text)
        for phase in record.get('phase_decisions', []):
            for site in phase.get('sites', []):
                for evidence in site.get('geographic_evidence', []):
                    file = Path(evidence.get('file', ''))
                    if (file.suffix == '.xml' and file.is_relative_to(AUDIT)
                            and (ROOT/file).is_file()
                            and (ROOT/file).stat().st_size < 500000):
                        paths.add(file)
    paths.update(Path(p) for p in SOURCE_FILES)
    paths.update(AUDIT/p for p in AUDIT_FILES)
    paths.update(p.relative_to(ROOT) for p in (ROOT/AUDIT).glob('reconciliation-*.json'))
    paths.difference_update(materialized)
    paths.add(payload_manifest_path)
    paths.update(binary_paths)
    previous = json.loads(args.previous_hashes.read_text()) if args.previous_hashes and args.previous_hashes.exists() else {}
    entries, hashes, blobs = [], {}, []
    for file in sorted(paths):
        raw = contents[file].encode('utf-8') if file in contents else (ROOT/file).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        hashes[str(file)] = digest
        if previous.get(str(file)) != digest:
            entry = {'path': str(file), 'mode': '100644', 'type': 'blob'}
            if file in binary_paths:
                git_sha = hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()
                blobs.append({'path': str(file), 'encoding': 'base64',
                              'content': base64.b64encode(raw).decode(),
                              'sha256': digest, 'git_sha': git_sha})
                entry['sha'] = git_sha
            else:
                entry['content'] = raw.decode('utf-8')
            entries.append(entry)
    # Migrate previously tracked hydrated JSON; never infer unrelated deletions.
    for file in sorted(materialized):
        if str(file) in previous:
            entries.append({'path': str(file), 'mode': '100644', 'type': 'blob', 'sha': None})
    # ASCII outer JSON allows exact, bounded chunk reads through tool transports.
    bundle = json.dumps(entries, ensure_ascii=True)
    args.output.write_text(bundle)
    args.output.with_suffix('.hashes.json').write_text(json.dumps(hashes))
    blobs_path = args.output.with_suffix('.blobs.json')
    blobs_path.write_text(json.dumps(blobs))
    print(json.dumps({'files': len(paths), 'changed': len(entries),
                      'source_reviews': review_count, 'characters': len(bundle),
                      'parts': (len(bundle)+199999)//200000,
                      'binary_blobs': len(blobs), 'blobs_file': str(blobs_path)}))

if __name__ == '__main__':
    main()
