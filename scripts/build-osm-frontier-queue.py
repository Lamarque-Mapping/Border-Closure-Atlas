#!/usr/bin/env python3
"""Build an auditable workbook-led OSM research queue; never infer closure links."""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'research/osm/international-review'
POLICY_CONTEXTS = {
    'frontier-canada-united-states': ['CAN', 'USA'],
    'frontier-portugal-spain': ['PRT', 'ESP'],
}
GENERIC = re.compile(r'^(?:not (?:individually )?(?:established|enumerated)|nationwide(?: relevant road posts)?|'
                     r'national land (?:crossings|entry ports|ports|border outlets|borders)|'
                     r'road border crossings|all land borders|international border points)$', re.I)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_data(path):
    text = Path(path).read_text(encoding='utf-8').strip()
    prefix = 'window.BORDER_DATA = '
    if not text.startswith(prefix) or not text.endswith(';'):
        raise ValueError('Expected the canonical BORDER_DATA assignment; JavaScript is never executed')
    return json.loads(text[len(prefix):-1])


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def csv_cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    # Spreadsheet applications may trim whitespace before evaluating a formula.
    if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value


def write_csv(path, rows, fields):
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore', quoting=csv.QUOTE_ALL, lineterminator='\n')
        writer.writeheader()
        writer.writerows({key: csv_cell(row.get(key)) for key in fields} for row in rows)


def crossing_text_screen(event):
    text = event.get('crossings') or ''
    if not text.strip():
        return 'no_crossing_field'
    if GENERIC.fullmatch(text.strip().rstrip('.')):
        return 'generic_or_unenumerated_text'
    # The replacement workbook supersedes the old spatial_screen. Its Locations
    # rows distinguish extracted names from generic scope, while explicitly
    # withholding geographic identity and phase applicability.
    if any(row.get('Coordinate status') == 'verified_primary_source_marker' or
           str(row.get('Marker precision') or '').startswith('medium')
           for row in event.get('workbook_locations', [])):
        return 'specific_location_text_review_lead'
    return 'scope_text_review_lead'


def transport_hint(text):
    """A conservative text triage only, not identification of a transport facility."""
    text = text.casefold()
    rail = bool(re.search(r'\brail(?:way|road)?\b|\btrain\b', text))
    ferry = bool(re.search(r'\bferr(?:y|ies)\b|\briver transport\b', text))
    pedestrian = bool(re.search(r'\bpedestrian\b|\bpedwest\b|\bped(?:estrian)?-only\b|\bfootbridge\b', text))
    road = bool(re.search(r'\broad\b|\bhighway\b|\bvehicle\b|\btruck\b|\bmotorway\b', text))
    modes = [name for name, present in [('rail', rail), ('ferry', ferry), ('pedestrian', pedestrian)] if present]
    if modes and not road and len(modes) == 1:
        return modes[0] + '_text_deferred'
    if modes:
        return 'mixed_or_uncertain_transport_text'
    return 'road_or_unspecified_text'


def main_road_text_screen(text):
    return not transport_hint(text).endswith('_text_deferred')


def build(data, coverage):
    features = {f['properties']['location_id']: f for f in
                data['locations']['features'] + data.get('context_locations', {}).get('features', [])}
    if len(features) != len(data['locations']['features']) + len(data.get('context_locations', {}).get('features', [])):
        raise ValueError('Duplicate geography identity')
    links = defaultdict(set)
    for link in data.get('links', []):
        links[link['event_id']].add(link['location_id'])
    contexts = {item['location_id']: item['context_location_id'] for item in data.get('crossing_contexts', [])}
    if len(contexts) != len(data.get('crossing_contexts', [])):
        raise ValueError('A crossing reference has duplicate context mappings')
    # Natural Earth's bundled attributes use -99 for these otherwise ordinary
    # ISO identities. These label corrections never create frontier contexts.
    country_map = {'FRA': 'FR', 'NOR': 'NO'}
    names = {}
    for feature in data['countries']['features']:
        p = feature['properties']
        code = p.get('ADM0_A3')
        iso = p.get('ISO_A2')
        names[code] = p.get('ADMIN', code)
        if isinstance(iso, str) and re.fullmatch('[A-Z]{2}', iso):
            country_map[code] = iso
    pairs, records, leads = {}, [], []
    ids = set()
    for event in data['events']:
        if event.get('inclusion_status', 'Included') != 'Included' or event.get('quarantined'):
            continue
        if event['id'] in ids:
            raise ValueError('Duplicate included record identity')
        ids.add(event['id'])
        locs = sorted(set(event.get('location_ids', [])) | links[event['id']])
        pair_keys, unresolved, existing_points = set(), [], defaultdict(list)
        for location_id in locs:
            context_id = contexts.get(location_id, location_id)
            feature = features.get(context_id, {})
            props = feature.get('properties', {})
            codes = props.get('country_codes', POLICY_CONTEXTS.get(context_id, []))
            if len(codes) != 2 or len(set(codes)) != 2:
                unresolved.append(location_id)
                continue
            codes = sorted(codes)
            key = '-'.join(codes)
            pair_keys.add(key)
            original = features.get(location_id, {})
            if original.get('geometry', {}).get('type') == 'Point' and original.get('properties', {}).get('display_role') == 'crossing_reference':
                existing_points[key].append(location_id)
            if key not in pairs:
                iso = sorted(country_map[c] for c in codes if c in country_map)
                pair_iso = '-'.join(iso) if len(iso) == 2 else None
                status = coverage.get('frontiers', {}).get(pair_iso, {})
                pairs[key] = {
                    'frontier_key': key, 'country_codes_natural_earth': codes,
                    'country_pair_iso2': iso if len(iso) == 2 else None, 'pair_key_iso2': pair_iso,
                    'label': '–'.join(names.get(c, c) for c in codes),
                    'frontier_location_id': context_id, 'frontier_location_ids': [],
                    'record_ids': [], 'single_frontier_record_ids': [], 'context_only_record_ids': [],
                    'specific_location_text_record_ids': [], 'single_frontier_specific_text_record_ids': [],
                    'main_road_text_priority_record_ids': [], 'existing_crossing_reference_record_ids': [],
                    'osm_coverage_status': status.get('status', 'not_started'),
                    'coverage_evidence_paths': status.get('evidence_paths', []),
                    'extraction_status': status.get('extraction_status', 'not_started'),
                    'reference_review_status': status.get('reference_review_status', 'not_started'),
                    'coverage_note': status.get('note', 'No completed research batch is recorded; this is not a completeness assessment.'),
                    'source_url': props.get('source_url'), 'source_version': props.get('source_version'),
                    'source_feature_ids': props.get('source_feature_ids', []),
                    'disputed_source_feature_ids': props.get('disputed_source_feature_ids', []),
                    'iso2_mapping_requires_review': len(iso) != 2,
                    'is_closure_evidence': False, 'accepted_event_crossing_links': [],
                }
            pairs[key]['frontier_location_ids'].append(context_id)
        disposition = ('multi_frontier_scope_review' if len(pair_keys) > 1 else
                       'single_frontier_context' if len(pair_keys) == 1 and not unresolved else
                       'nonbilateral_or_unresolved_geography_review')
        primary = next(iter(pair_keys)) if disposition == 'single_frontier_context' else None
        screen = crossing_text_screen(event)
        specific = screen == 'specific_location_text_review_lead'
        main = specific and main_road_text_screen(event.get('crossings') or '')
        record = {
            'record_id': event['id'], 'title': event.get('title', ''), 'region': event.get('region', ''),
            'rationales': event.get('rationales', []),
            'rationale_subcategories': event.get('rationale_subcategories', {}),
            'rationale_coding_status': event.get('rationale_coding_status'),
            'countries_verbatim': event.get('countries', []), 'crossings_verbatim': event.get('crossings', ''),
            'scope_verbatim': event.get('scope', ''),
            'workbook_location_rows': event.get('workbook_locations', []),
            'phase_location_rows': event.get('phase_locations', []),
            'location_ids': locs, 'context_frontier_keys': sorted(pair_keys), 'primary_frontier_key': primary,
            'unresolved_location_links': sorted(unresolved), 'primary_disposition': disposition,
            'crossing_text_screen': screen, 'transport_text_hint': transport_hint(event.get('crossings') or ''),
            'main_road_text_priority_eligible': main, 'existing_crossing_reference_ids': sorted({p for v in existing_points.values() for p in v}),
            'accepted_event_crossing_links': [], 'eligible_for_automatic_acceptance': False,
        }
        records.append(record)
        if (event.get('crossings') or '').strip():
            leads.append({**record, 'lead_id': 'workbook-text-' + event['id'],
                          'lead_unit': 'one verbatim workbook crossing field; not an individual facility',
                          'identity_status': 'not_resolved', 'automatic_geography_link': False})
        for key in sorted(pair_keys):
            row = pairs[key]
            row['record_ids'].append(event['id'])
            row['single_frontier_record_ids' if primary == key else 'context_only_record_ids'].append(event['id'])
            if specific:
                row['specific_location_text_record_ids'].append(event['id'])
            if specific and primary == key:
                row['single_frontier_specific_text_record_ids'].append(event['id'])
            if main and primary == key:
                row['main_road_text_priority_record_ids'].append(event['id'])
            if existing_points[key]:
                row['existing_crossing_reference_record_ids'].append(event['id'])
    record_map = {r['record_id']: r for r in records}
    frontiers = list(pairs.values())
    for row in frontiers:
        for field in ['frontier_location_ids', 'record_ids', 'single_frontier_record_ids', 'context_only_record_ids',
                      'specific_location_text_record_ids', 'single_frontier_specific_text_record_ids',
                      'main_road_text_priority_record_ids', 'existing_crossing_reference_record_ids']:
            row[field] = sorted(set(row[field]))
        row['frontier_location_id'] = row['frontier_location_ids'][0]
        regions = Counter(record_map[i]['region'] for i in row['record_ids'])
        row['workbook_region_counts'] = dict(sorted(regions.items()))
        row['batch_region'] = sorted(regions, key=lambda region: (-regions[region], region))[0]
        for out, field in [('record_count', 'record_ids'),
                           ('specific_location_text_review_lead_count', 'specific_location_text_record_ids'),
                           ('single_frontier_specific_text_count', 'single_frontier_specific_text_record_ids'),
                           ('single_frontier_main_road_text_priority_count', 'main_road_text_priority_record_ids'),
                           ('existing_crossing_reference_record_count', 'existing_crossing_reference_record_ids')]:
            row[out] = len(row[field])
    frontiers.sort(key=lambda r: (-r['single_frontier_main_road_text_priority_count'],
                                 -r['existing_crossing_reference_record_count'],
                                 -r['specific_location_text_review_lead_count'], -r['record_count'], r['frontier_key']))
    for rank, row in enumerate(frontiers, 1):
        row['priority_rank'] = rank
    regions = defaultdict(list)
    for row in frontiers:
        regions[row['batch_region']].append(row['frontier_key'])
    records.sort(key=lambda r: r['record_id'])
    leads.sort(key=lambda r: r['record_id'])
    summary = {
        'included_record_count': len(records),
        'excluded_record_ids': sorted(e['id'] for e in data['events'] if e['id'] not in ids),
        'rationale_counts': dict(sorted(Counter(c for row in records for c in row['rationales']).items())),
        'primary_dispositions': dict(sorted(Counter(r['primary_disposition'] for r in records).items())),
        'frontiers_with_workbook_context': len(frontiers),
        'record_frontier_context_associations': sum(r['record_count'] for r in frontiers),
        'nonempty_crossing_text_records': len(leads),
        'crossing_text_screens': dict(sorted(Counter(r['crossing_text_screen'] for r in records).items())),
        'unassigned_record_count': sum(r['primary_frontier_key'] is None for r in records),
        'osm_coverage_statuses': dict(sorted(Counter(r['osm_coverage_status'] for r in frontiers).items())),
        'automatic_event_crossing_links': 0,
    }
    return {'frontiers': frontiers, 'records': records, 'leads': leads,
            'regional_batches': [{'region': region, 'frontier_keys_in_priority_order': keys} for region, keys in sorted(regions.items())],
            'summary': summary}


def default_coverage():
    pairs = {}
    for pair in ['CD-UG', 'KE-UG', 'RW-UG', 'SS-UG', 'TZ-UG']:
        pairs[pair] = {'status': 'uganda_desk_review_completed',
                       'evidence_paths': ['research/osm/uganda-review/REVIEW.md'],
                       'extraction_status': 'completed_scoped_snapshot',
                       'reference_review_status': 'completed_qualified_desk_review',
                       'note': 'Prior Uganda reference sample reviewed with recorded qualifications; no census or operating-status claim.'}
    for pair in ['KE-TZ', 'DE-FR', 'MX-US', 'KE-SO']:
        pairs[pair] = {'status': 'international_batch_planned', 'evidence_paths': [],
                       'extraction_status': 'planned', 'reference_review_status': 'planned',
                       'note': 'Main-road research batch; extraction and independent reference review are tracked separately.'}
    return {'schema_version': 1, 'note': 'Research-batch status only, not crossing completeness, closure evidence or current operating status.', 'frontiers': pairs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=ROOT / 'dist/data.js')
    parser.add_argument('--output', type=Path, default=BASE)
    parser.add_argument('--coverage', type=Path, default=BASE / 'frontier-queue-coverage.json')
    args = parser.parse_args()
    data = read_data(args.data)
    if not args.coverage.exists():
        args.coverage.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.coverage, default_coverage())
    coverage = json.loads(args.coverage.read_text())
    result = build(data, coverage)
    inputs = [args.data, args.coverage, Path(__file__)]
    provenance = {'workbook_sha256': data['meta']['source_sha256'],
                  'canonical_data_sha256': digest(args.data),
                  'input_sha256': {str(p.resolve().relative_to(ROOT)) if p.resolve().is_relative_to(ROOT) else str(p.resolve()): digest(p) for p in inputs}}
    method = {
        'frontier_basis': 'Current compiled reference-line links and explicit crossing_contexts only. This queue does not create additional pairs from country co-occurrence. These reference lines are not approved phase geometry or closure extents.',
        'record_assignment': 'Each included record has one ledger row. A sole bilateral context is primary only if there are no unresolved links; multiple contexts remain scope-review work.',
        'text_lead_unit': 'Whole workbook crossing field, verbatim. One field can name multiple locations or no individually identifiable facility.',
        'text_screen_basis': 'Current workbook Locations rows: verified primary-source marker or medium text/name precision. Low-precision and narrative scope remain review leads without named-location priority. This never establishes a facility identity or phase applicability.',
        'rationale_basis': 'Current replacement-workbook categories, subcategories and coding status; overlapping categories are retained without a primary motive.',
        'priority_order': ['single-frontier specific text excluding explicit rail/ferry/pedestrian-only text', 'existing crossing-reference records', 'all specific-location text records', 'all contextual records', 'frontier key'],
        'transport_screen': 'Text-only triage; mixed and unknown modes require review. No facility, source association or event link is accepted automatically.',
        'regional_batch_basis': 'Most frequent workbook region among contextual records; alphabetical tie-break.',
        'coverage': 'Historical extraction and reference-review status are independent and never establish all-crossing completeness or validate links to the replacement workbook.',
        'iso_label_corrections': {'FRA': 'FR', 'NOR': 'NO'},
        'point_display_enabled': False,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / 'frontier-queue.json', {'schema_version': 2, 'provenance': provenance, 'method': method,
                                                  'rationale_categories': data.get('meta', {}).get('rationale_categories', []),
                                                  **{key: result[key] for key in ['summary', 'frontiers', 'regional_batches']}})
    write_json(args.output / 'frontier-queue-records.json', {'schema_version': 2, 'provenance': provenance, 'records': result['records']})
    write_json(args.output / 'workbook-named-locations.json', {'schema_version': 2, 'provenance': provenance, 'leads': result['leads']})
    write_csv(args.output / 'frontier-queue.csv', result['frontiers'], list(result['frontiers'][0]) if result['frontiers'] else ['frontier_key'])
    write_csv(args.output / 'frontier-queue-records.csv', result['records'], list(result['records'][0]) if result['records'] else ['record_id'])
    write_csv(args.output / 'workbook-named-locations.csv', result['leads'], list(result['leads'][0]) if result['leads'] else ['record_id'])
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
