#!/usr/bin/env python3
"""Stage a small public research checkpoint, excluding publisher page copies."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = Path('research/geography-audit-2026-10-29')
SOURCE_FILES = [
    '.github/workflows/pages.yml', 'dist/core.js', 'dist/index.html', 'source/crossings/README.md',
    'source/crossings/locations.json', 'source/crossings/scope-review.json',
    'source/current-release-manifest.json',
    'scripts/geography-audit-progress.cjs', 'scripts/apply-geography-audit.cjs',
    'scripts/verify-geography-audit.cjs', 'scripts/prepare-geography-checkpoint.py',
    'scripts/build-crossing-geography.cjs', 'scripts/verify-crossing-map.cjs',
    'scripts/build_geography_audit_report.py', 'scripts/build-gis-downloads.py',
    'scripts/verify-gis-downloads.py', 'scripts/analysis-template.html',
]
AUDIT_FILES = ['README.md', 'audit-plan.json', 'baseline-map-bindings.json',
               'reconciled-decisions.json', 'integration-receipt.json']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--previous-hashes', type=Path)
    args = parser.parse_args()
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
    previous = json.loads(args.previous_hashes.read_text()) if args.previous_hashes and args.previous_hashes.exists() else {}
    entries, hashes = [], {}
    for file in sorted(paths):
        text = contents.get(file)
        if text is None:
            text = (ROOT/file).read_text()
        digest = hashlib.sha256(text.encode()).hexdigest()
        hashes[str(file)] = digest
        if previous.get(str(file)) != digest:
            entries.append({'path': str(file), 'mode': '100644', 'type': 'blob', 'content': text})
    # ASCII outer JSON allows exact, bounded chunk reads through tool transports.
    bundle = json.dumps(entries, ensure_ascii=True)
    args.output.write_text(bundle)
    args.output.with_suffix('.hashes.json').write_text(json.dumps(hashes))
    print(json.dumps({'files': len(paths), 'changed': len(entries),
                      'source_reviews': review_count, 'characters': len(bundle),
                      'parts': (len(bundle)+199999)//200000}))

if __name__ == '__main__':
    main()
