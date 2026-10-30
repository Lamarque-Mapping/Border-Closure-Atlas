"""Attach individually written descriptions checked by two different reviewers.

This presentation layer never edits the native evidence, chronology or coding.
Descriptions are bound to the exact source content the reviewers inspected.
"""
import hashlib
import gzip
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTION_PATH = ROOT / 'source/record-descriptions.json.gz'
INPUT_FIELDS = ('id', 'title', 'event_hash', 'scope', 'movement', 'official_rationale',
                'context', 'inclusion_status', 'current_review')
PHASE_FIELDS = ('period_id', 'measure_type', 'start_earliest', 'start_latest',
                'end_earliest', 'end_latest', 'last_confirmed', 'scope', 'movement',
                'direction', 'authority', 'basis', 'qualification', 'endpoint_status',
                'observed_reopening', 'analysis_included', 'contested',
                'temporal_display_rule', 'source_urls')


@lru_cache(maxsize=1)
def status_evidence():
    source = ROOT/'source/border-status-review.json'
    data = json.loads(source.read_text())
    return {row['record_id']: row for row in data.get('audit', {}).get('records', [])}


def input_hash(event):
    value = {key: event.get(key) for key in INPUT_FIELDS}
    value['phases'] = [{key: phase.get(key) for key in PHASE_FIELDS}
                       for phase in event.get('duration_periods', event.get('phases', []))]
    value['later_status_evidence'] = status_evidence().get(event['id'])
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def attach_descriptions(data):
    if not DESCRIPTION_PATH.exists():
        return
    document = json.loads(gzip.decompress(DESCRIPTION_PATH.read_bytes()))
    entries = document['records']
    events = {event['id']: event for event in data['events']}
    assert set(entries) == set(events), 'Description coverage must match the current register'
    for rid, entry in entries.items():
        event = events[rid]
        assert entry['event_hash'] == event['event_hash'], (rid, 'Changed source identity')
        assert entry['input_sha256'] == input_hash(event), (rid, 'Description needs review against changed evidence')
        reviews = entry['reviews']
        assert [review['pass'] for review in reviews] == [1, 2], (rid, 'Two prose reviews required')
        assert reviews[0]['reviewer'] != reviews[1]['reviewer'], (rid, 'Different reviewers required')
        assert reviews[1]['status'] in ('accepted', 'revised'), (rid, 'Unresolved description')
        assert 20 <= len(entry['summary'].split()) <= 125, (rid, 'Description length')
        event['record_summary'] = {
            'text': entry['summary'], 'source_event_hash': entry['event_hash'],
            'review_date': document['review_date'], 'passes': 2,
            'evidence_urls': entry['evidence_urls'],
        }
    data['meta']['description_review'] = {
        'review_date': document['review_date'], 'records': len(entries), 'passes': 2,
        'method': document['method'],
        'source_sha256': hashlib.sha256(DESCRIPTION_PATH.read_bytes()).hexdigest(),
    }
