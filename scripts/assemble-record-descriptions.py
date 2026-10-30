#!/usr/bin/env python3
"""Reconcile saved author and independent verifier files into the prose overlay."""
import json
import gzip
from pathlib import Path
from record_descriptions import ROOT, DESCRIPTION_PATH, input_hash, status_evidence

REVIEW = ROOT / 'research/description-review-2026-10-30'
data = json.loads((ROOT/'dist/data.js').read_text().removeprefix('window.BORDER_DATA = ').strip().removesuffix(';'))
events = {event['id']: event for event in data['events']}
baseline = json.loads((REVIEW/'baseline.json').read_text())


def read_pass(number):
    rows = {}
    for file in sorted((REVIEW/f'pass{number}').glob('*.jsonl')):
        for line in file.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            verification = row['verification']
            if 'pass' not in verification and 'pass_number' in verification:
                verification['pass'] = verification.pop('pass_number')
            assert verification['pass'] == number, (row['id'], 'Unexpected review pass')
            assert row['id'] not in rows, (file, row['id'], 'Duplicate review')
            rows[row['id']] = row
    assert set(rows) == set(events), (number, 'Missing or unexpected IDs', sorted(set(events)-set(rows)))
    return rows


first, second = read_pass(1), read_pass(2)
records = {}
for rid, event in events.items():
    a, b = first[rid], second[rid]
    assert a['event_hash'] == b['event_hash'] == event['event_hash'], rid
    assert input_hash(event) == baseline['description_input_sha256'][rid], (rid, 'Current data differs from reviewed snapshot')
    assert a['verification']['reviewer'] != b['verification']['reviewer'], rid
    assert b['verification']['status'] in ('accepted', 'revised'), rid
    urls = list(dict.fromkeys(a['evidence_urls']+b['evidence_urls']))
    known_urls = set(event.get('source_urls', [])) | {s.get('url') for s in event.get('sources', [])}
    known_urls |= {url for phase in event['duration_periods'] for url in phase.get('source_urls', [])}
    known_urls |= {url for claim in event['current_review']['claims'] for url in claim.get('source_urls', [])}
    supplement = status_evidence().get(rid, {})
    known_urls |= {s.get('url') for s in supplement.get('sources', [])}
    assert set(urls) <= known_urls, (rid, 'Uncatalogued evidence URL', set(urls)-known_urls)
    records[rid] = {
        'event_hash': event['event_hash'], 'input_sha256': baseline['description_input_sha256'][rid],
        'summary': b['summary'], 'evidence_urls': urls,
        'reviews': [a['verification'], b['verification']],
    }
document = {
    'format': 'border-closures.record-descriptions.v1', 'review_date': '2026-10-30',
    'method': 'Individual case descriptions, followed by a second verification pass by a different AI agent for every record. Reviewers reused the saved source evidence and current audited phases; any fresh source checks are identified in the review logs. This is a prose and claim-consistency review, not a new full-register web scrape.',
    'records': records,
}
DESCRIPTION_PATH.write_bytes(gzip.compress((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode(), mtime=0))
print(json.dumps({'descriptions': len(records), 'reviews': len(records)*2}))
