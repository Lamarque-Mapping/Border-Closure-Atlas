"""Publish a readable geography audit register alongside reproducible AI reviews."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT/'research/geography-audit-2026-10-29'
NAME = 'Global_Border_Closures_Geography_Audit.zip'


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def csv_bytes(rows):
    fields = list(dict.fromkeys(key for row in rows for key in row))
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: "'"+value if isinstance(value, str) and value.startswith(
            ('=', '+', '-', '@', '\t', '\r')) else value for key, value in row.items()})
    return b'\xef\xbb\xbf'+out.getvalue().encode()


def build(output):
    plan = json.loads((AUDIT/'audit-plan.json').read_text())
    decisions = json.loads((AUDIT/'reconciled-decisions.json').read_text())
    accepted = {d['record_id']: d for d in decisions['decisions']}
    assert len(accepted) == len(decisions['decisions']), 'duplicate reconciliation'
    data = json.loads(re.sub(r';\s*$', '', (ROOT/'dist/data.js').read_text().removeprefix('window.BORDER_DATA = ')))
    assert data['meta']['source_sha256'] == plan['source_sha256'] == decisions['source_sha256']
    events = {e['id']: e for e in data['events']}
    records, phases, members = [], [], {}
    for group, ids in plan['groups'].items():
        for record_id in ids:
            event = events[record_id]
            reviews = {}
            for letter in ['a', 'b']:
                path = AUDIT/f'pass-{letter}/{record_id}.json'
                if path.exists():
                    raw = path.read_bytes()
                    reviews[letter] = json.loads(raw)
                    members[f'pass-{letter}/{record_id}.json'] = raw
            if len(reviews) == 2:
                assert reviews['a']['agent'] != reviews['b']['agent'], 'separate reconstruction agents required'
            decision = accepted.get(record_id)
            if decision:
                for ref in decision['audit_passes']:
                    key = str(Path(ref['path']).relative_to(AUDIT.relative_to(ROOT)))
                    assert hashlib.sha256(members[key]).hexdigest() == ref['sha256'], 'unreconciled evidence revision'
            decided = {p['phase_id']: p for p in (decision or {}).get('phases', [])}
            mapped = [p for p in decided.values() if p['decision'] != 'hold']
            pending = not decision
            notes = []
            if not event.get('duration_periods'):
                notes.append('No canonical dated phase exists; a temporal map binding would require evidence for dates, not an invented interval.')
            for original in event.get('duration_periods', []):
                phase_id = original['period_id']
                phase = decided.get(phase_id, {})
                note = phase.get('qualification') or phase.get('rationale', '')
                if note:
                    notes.append(phase_id+': '+note)
                phases.append({
                    'record_id': record_id, 'phase_id': phase_id,
                    'original_scope': original.get('scope', ''),
                    'analysis_included': original.get('analysis_included') is not False,
                    'decision': phase.get('decision', 'pending'),
                    'geography_category': phase.get('category', ''),
                    'complete_geography': phase.get('complete', False),
                    'site_names': ' | '.join(s['name'] for s in phase.get('sites', [])),
                    'site_coordinates_lon_lat': json.dumps([s['coordinates'] for s in phase.get('sites', [])]),
                    'border_reference_ids': ' | '.join(phase.get('border_reference_ids', [])),
                    'qualification': phase.get('qualification', ''),
                    'reconciliation_reason': phase.get('rationale', ''),
                    'original_phase_source_urls': '\n'.join(original.get('source_urls', []))})
            checked_urls = list(dict.fromkeys(s['url'] for r in reviews.values() for s in r.get('source_checks', [])))
            records.append({
                'record_id': record_id, 'title': event['title'], 'audit_group': group,
                'countries': ' | '.join(event.get('countries', [])),
                'canonical_phase_count': len(event.get('duration_periods', [])),
                'pass_a_status': reviews.get('a', {}).get('verification_status', 'pending'),
                'pass_a_agent': reviews.get('a', {}).get('agent', ''),
                'pass_b_status': reviews.get('b', {}).get('verification_status', 'pending'),
                'pass_b_agent': reviews.get('b', {}).get('agent', ''),
                'both_passes_saved': len(reviews) == 2,
                'reconciliation': 'pending' if pending else 'mapped_at_least_one_phase' if mapped else 'held_unmapped',
                'accepted_phase_count': len(mapped),
                'partial_geography_phase_count': sum(p['decision'] == 'partial' for p in mapped),
                'held_phase_count': sum(p['decision'] == 'hold' for p in decided.values()),
                'qualifications': '\n'.join(notes),
                'checked_source_urls': '\n'.join(checked_urls),
                'original_record_source_urls': '\n'.join(event.get('source_urls', []))})
    counts = {
        'assigned_records': len(records),
        'pass_a_saved': sum(r['pass_a_status'] != 'pending' for r in records),
        'pass_b_saved': sum(r['pass_b_status'] != 'pending' for r in records),
        'both_passes_saved': sum(r['both_passes_saved'] for r in records),
        'reconciled_records': len(accepted),
        'newly_mapped_records': sum(r['reconciliation'] == 'mapped_at_least_one_phase' for r in records),
        'held_unmapped_records': sum(r['reconciliation'] == 'held_unmapped' for r in records),
        'pending_reconciliation_records': sum(r['reconciliation'] == 'pending' for r in records)}
    assert counts['assigned_records'] == plan['baseline']['unmapped_records']
    summary = {'audit_id': plan['audit_id'], 'review_date': '2026-10-29',
        'source_sha256': plan['source_sha256'], 'status': decisions['status'],
        'baseline': plan['baseline'], 'counts': counts,
        'limitation': 'Two independent AI reconstructions, followed by reconciliation; not independent human or different-model verification. Source access varies. Geography approval does not resolve chronology or prove present operation.'}
    common = {'geography-audit-records.csv': csv_bytes(records),
              'geography-audit-phases.csv': csv_bytes(phases),
              'geography-audit-summary.json': json_bytes(summary)}
    members.update(common)
    for name in ['README.md', 'audit-plan.json', 'reconciled-decisions.json',
                 'new-site-metadata-corrections.json']:
        members[name] = (AUDIT/name).read_bytes()
    members['READ-ME-FIRST.txt'] = (
        'GEOGRAPHY AUDIT — 29 OCTOBER 2026\n\n'
        'This package audits the 387 included records without map geometry in the starting release. '
        'It does not re-audit all 826 included records. The original 439 mapped records are protected by regression checks.\n\n'
        'Open geography-audit-records.csv for one row per assigned record, and geography-audit-phases.csv for phase decisions. '
        'The two pass folders preserve separate AI source reconstructions, access limits and original links. '
        'Reconciled decisions are the only mapping approvals; pending reviews and proposals are not approvals. '
        'Map means supported geography for that phase, not present closure or a resolved duration. '
        'Partial means only part of the scope or an approximate crossing-area reference is located. '
        'Hold means evidence is not sufficient for a supported mapping decision.\n\n'
        'The native chronology, movement cohorts, exclusions and duration rules were not changed by this geography audit. '
        'Short and uncertain-duration records remain available under All; the >24h default still applies on the site. '
        'Later-status and national-policy supplements are separate. '
        'Review completion does not imply full source access, independent reporting origins, or human verification. '
        'Use the retained original news and government URLs to check claims directly. '
        'The metadata review records corrected country labels and duplicate-facility decisions. '
        'Publisher articles are not republished in this archive.\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in common.items():
        (output/name).write_bytes(raw)
    with zipfile.ZipFile(output/NAME, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 29, 0, 0, 0))
            info.external_attr = 0o644 << 16
            z.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return common, summary


if __name__ == '__main__':
    _, result = build(ROOT/'dist/downloads')
    print(json.dumps(result))
