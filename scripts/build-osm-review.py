#!/usr/bin/env python3
"""Build a source-reviewed crossing directory; never modify closure data.

Inputs are deliberately separate: frozen OSM extraction, geometry diagnostics,
source-reviewed benchmark identities and source-reviewed event links. No spatial
proximity or name-normalisation rule can promote an event link in this builder.
"""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def csv_write(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            result = {}
            for key in fields:
                value = row.get(key)
                if isinstance(value, (list, dict)):
                    value = json.dumps(value, ensure_ascii=False)
                if isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
                    value = "'" + value
                result[key] = value
            writer.writerow(result)


def build(args):
    pilot, out = args.pilot, args.output
    out.mkdir(parents=True, exist_ok=True)
    original = read(pilot / 'crossing-candidates.geojson')['features']
    candidates = {f['id']: f for f in original}
    baseline = read(pilot / 'summary.json')
    evidence = read(out / 'event-link-review.json')
    scope_policy = read(out / 'scope-policy.json')
    targeted = {x['crossing_id']: x['reason'] for x in scope_policy['targeted_exceptions']}
    main_classes = set(scope_policy['main_highway_classes'])
    data = json.loads(args.data.read_text().removeprefix('window.BORDER_DATA = ').rstrip().removesuffix(';'))
    events = {e['id']: e for e in data['events'] if not e.get('quarantined')}
    assert evidence['workbook_sha256'] == baseline['workbook_sha256'] == data['meta']['source_sha256']
    benchmarks = [(f, read(f)) for f in sorted(out.glob('benchmark-*.json'))]
    if not benchmarks:
        raise ValueError('Source-reviewed benchmarks required')
    sources, directory = {}, []
    supporting, proposed = defaultdict(list), defaultdict(list)
    for path, benchmark in benchmarks:
        for source in benchmark['sources']:
            if source['id'] in sources and sources[source['id']] != source:
                raise ValueError('Conflicting source ID: ' + source['id'])
            sources[source['id']] = source
        for crossing in benchmark['crossings']:
            item = dict(crossing)
            item['review_input'] = path.name
            item['is_closure_evidence'] = False
            item['current_operation_status'] = 'not_assessed'
            item['transport_mode_evidence'] = {
                'working_reference_class': item['mode'],
                'mapped_route_class_supported': item['candidate_match_status'] == 'supported',
                'formal_vehicle_access_verified': False,
                'current_vehicle_access_verified': False,
                'classification_note': item.get('mode_status', 'See source-specific notes')}
            item['source_urls'] = [sources[s]['url'] for s in item['source_ids']]
            item['osm_candidates'] = []
            for cid in item['candidate_ids']:
                candidate = candidates[cid]
                p = candidate['properties']
                assert p['mode'] == item['mode'], (item['id'], 'mode mismatch')
                assert sorted(c['iso2'] for c in p['country_relations']) == sorted(item['country_pair']), (item['id'], 'country mismatch')
                item['osm_candidates'].append({'candidate_id': cid,
                    'coordinate': candidate['geometry']['coordinates'],
                    'route_osm_ids': p['route_osm_ids'], 'road_tiers': p['road_tiers'],
                    'association_status': item['candidate_match_status']})
                proposed[cid].append(item['id'])
                if item['candidate_match_status'] == 'supported':
                    supporting[cid].append(item['id'])
            # Exact facility coordinates remain separate from a reviewed OSM
            # road/boundary correspondence. Do not choose among alternatives.
            item['osm_reference_coordinate'] = (
                item['osm_candidates'][0]['coordinate']
                if item['candidate_match_status'] == 'supported' and len(item['osm_candidates']) == 1 else None)
            item['coordinate_accuracy_m'] = None
            item['coordinate_accuracy_note'] = 'No surveyed accuracy claimed; see source point and route review.'
            item['global_scope'] = ('targeted_named_exception' if item['id'] in targeted else
                'main_road_candidate' if any(any(k.removesuffix('_link') in main_classes
                    for k in candidates[cid]['properties']['highway_classes']) for cid in item['candidate_ids'])
                else 'background_reference_only')
            directory.append(item)
    by_crossing = {c['id']: c for c in directory}
    assert len(by_crossing) == len(directory), 'Crossing IDs must be globally unique'
    road_exceptions = [{'crossing_id': cid, 'reason': reason,
        'route_osm_ids': sorted({wid for candidate in by_crossing[cid]['osm_candidates'] for wid in candidate['route_osm_ids']}),
        'source_urls': by_crossing[cid]['source_urls']}
        for cid, reason in targeted.items()]
    targeted_candidates = {candidate for cid in targeted for candidate in by_crossing[cid]['candidate_ids']}
    for source in evidence['sources']:
        assert source['id'] not in sources
        sources[source['id']] = source

    links = []
    for link in evidence['links']:
        item = dict(link)
        crossing = by_crossing[item['crossing_id']]
        event = events[item['event_id']]
        assert item['link_status'] == 'verified_identity'
        assert item['workbook_crossings_verbatim'] == event['crossings']
        assert item['source_ids'] and set(item['source_ids']) <= sources.keys()
        assert sorted(item['country_pair']) == sorted(crossing['country_pair'])
        assert item['mode'] == crossing['mode']
        phase_ids = {p['period_id'] for p in event.get('duration_periods', [])}
        assert set(item.get('phase_ids', [])) <= phase_ids, (item['id'], phase_ids)
        item['crossing_identity_status'] = crossing['existence_status']
        item['geometry_match_status'] = crossing['candidate_match_status']
        item['supported_candidate_ids'] = crossing['candidate_ids'] if crossing['candidate_match_status'] == 'supported' else []
        item['unresolved_candidate_ids'] = crossing['candidate_ids'] if crossing['candidate_match_status'] != 'supported' else []
        item['source_urls'] = [sources[s]['url'] for s in item['source_ids']]
        item['published_on_map'] = False
        item['coordinate_status'] = 'reviewed_osm_correspondence_not_surveyed' if item['supported_candidate_ids'] else 'unresolved_exact_contact'
        links.append(item)

    raw_topology = read(out / 'topology-diagnostics.json')
    if isinstance(raw_topology, dict):
        raw_topology = raw_topology.get('candidates', raw_topology.get('diagnostics', raw_topology.get('rows')))
    topology = {r['candidate_id']: r for r in raw_topology}
    assert topology.keys() == candidates.keys(), 'Every original candidate needs geometry diagnostics'
    focused_path = out / 'main-road-extraction/crossing-candidates.geojson'
    lineage, new_ids = [], defaultdict(list)
    if focused_path.exists():
        raw_contacts = read(out / 'topology-contacts.json')
        by_route_boundary = defaultdict(list)
        for contact in raw_contacts:
            by_route_boundary[(contact['route_osm_id'], contact['boundary_osm_id'])].append(contact)
        focused = read(focused_path)['features']
        for f in focused:
            old_ids = set()
            for contact in f['properties']['raw_contacts']:
                x, y = contact['coordinate']
                matches = [r for r in by_route_boundary[(contact['route_osm_id'], contact['boundary_osm_id'])]
                    if abs(r['coordinate'][0] - x) < 1e-8 and abs(r['coordinate'][1] - y) < 1e-8]
                assert matches, 'Focused extraction contact must have frozen source lineage'
                old_ids.update(r['candidate_id'] for r in matches)
            lineage.append({'focused_candidate_id': f['id'], 'original_candidate_ids': sorted(old_ids),
                'basis': 'Same snapshot, same route and boundary IDs, raw coordinates agree within 1e-8 degree numerical tolerance',
                'carries_accepted_event_link': False})
            for cid in old_ids:
                new_ids[cid].append(f['id'])
    retired = defaultdict(list)
    for rejection in evidence['rejected_candidate_links']:
        retired[rejection['candidate_id']].append(rejection['event_id'])
    rows = []
    for f in original:
        p, cid = f['properties'], f['id']
        t = topology[cid]
        matched = [by_crossing[x] for x in supporting[cid]]
        possible = [by_crossing[x] for x in proposed[cid]]
        status = t['topology_status']
        if matched:
            outcome = 'source_supported_crossing_reference'
            reason = ' | '.join(x['match_reason'] for x in matched)
        elif possible:
            outcome = 'unresolved_named_reference'
            reason = ' | '.join(x['match_reason'] for x in possible)
        elif status == 'boundary_alignment_or_repeated_contacts':
            outcome = 'boundary_alignment_or_repeated_contact_review'
            reason = 'Repeated contacts in the same geometry corridor. Retained for review; not counted as separate verified facilities.'
        elif t.get('has_sustained_geometric_transition'):
            outcome = 'unverified_geometric_connection'
            reason = 'OSM route continues into both mapped country interiors under the stated test. No named-facility identity has been established.'
        else:
            outcome = 'unresolved_geometry'
            reason = 'No accepted named-facility match and no unambiguous sustained country transition under the test. This is not evidence of no crossing.'
        rows.append({'candidate_id': cid, 'country_pair': sorted(c['iso2'] for c in p['country_relations']),
            'mode': p['mode'], 'road_tiers': p['road_tiers'], 'route_names': p['route_names'],
            'route_osm_ids': p['route_osm_ids'], 'longitude': f['geometry']['coordinates'][0],
            'latitude': f['geometry']['coordinates'][1], 'review_outcome': outcome,
            'review_reason': reason, 'crossing_ids': proposed[cid], 'supported_crossing_ids': supporting[cid],
            'geometry_review_group_id': t.get('review_group_id'), 'topology_status': status,
            'focused_extraction_candidate_ids': new_ids[cid],
            'has_sustained_geometric_transition': t.get('has_sustained_geometric_transition', False),
            'review_flags': t.get('review_flags', []), 'retired_event_point_assignments': retired[cid],
            'source_urls': sorted({url for x in possible for url in x['source_urls']}),
            'review_method': 'Source desk review and automated geometry diagnostics; no field inspection',
            'global_scope': ('main_road' if any(k.removesuffix('_link') in main_classes for k in p['highway_classes'])
                             else 'targeted_named_exception' if cid in targeted_candidates else 'background_only'),
            'is_closure_evidence': False, 'published_on_map': False})
    major = [r for r in rows if 'major' in r['road_tiers']]
    source_entries = sorted(sources.values(), key=lambda s: s['id'])
    for source in source_entries:
        assert source['url'].startswith('https://'), source['id']
    documents = {}
    for source in source_entries:
        url = source['url']
        if url not in documents:
            documents[url] = {'id': 'SRC-' + hashlib.sha256(url.encode()).hexdigest()[:12],
                'url': url, 'source_aliases': [], 'titles': [], 'publishers': []}
        document = documents[url]
        document['source_aliases'].append(source['id'])
        for key, field in [('title', 'titles'), ('publisher', 'publishers')]:
            if source.get(key) and source[key] not in document[field]:
                document[field].append(source[key])
    for item in directory + links:
        item['source_document_ids'] = sorted({documents[url]['id'] for url in item['source_urls']})
    summary = {
        'reviewed_at': datetime.now(timezone.utc).isoformat(), 'schema_version': 1,
        'scope': 'Uganda pilot: source-reviewed reference directory, all original major-road candidates and named workbook locations',
        'workbook_sha256': baseline['workbook_sha256'], 'osm_data_timestamp': baseline['osm_data_timestamp'],
        'reference_entries': len(directory), 'reference_entries_by_working_transport_class': dict(Counter(c['mode'] for c in directory)),
        'reference_match_status': dict(Counter(c['candidate_match_status'] for c in directory)),
        'major_road_candidates_reviewed': len(major), 'all_candidates_with_geometry_diagnostics': len(rows),
        'major_road_review_outcomes': dict(Counter(c['review_outcome'] for c in major)),
        'event_crossing_identities': len(links), 'events_with_named_links': len({l['event_id'] for l in links}),
        'distinct_event_crossings': len({l['crossing_id'] for l in links}),
        'event_links_with_supported_osm_correspondence': sum(bool(l['supported_candidate_ids']) for l in links),
        'event_links_with_unresolved_geometry': sum(not l['supported_candidate_ids'] for l in links),
        'old_event_candidate_associations': evidence['summary']['old_event_candidate_associations'],
        'old_associations_retired_for_point_assignment': len(evidence['rejected_candidate_links']),
        'sources_distinct_urls': len({s['url'] for s in source_entries}),
        'global_scope_policy': scope_policy,
        'original_candidates_in_focused_scope': dict(Counter(r['global_scope'] for r in rows)),
        'focused_extraction_candidates': len(lineage),
        'limits': ['The reference list is not a complete inventory of all formal or informal crossings.',
            'Supported correspondence means named crossing and mapped route agree; no surveyed positional accuracy or current operation is claimed.',
            'Unknown candidates prevent an honest global precision/recall estimate. Recovery is reported against this dated, non-exhaustive benchmark only.',
            'All review uses AI-assisted desk research and automated checks; it is not independent human validation.',
            'Geometry review groups are not crossing-facility counts. Border alignment and exact gate questions remain explicit.',
            'Closure dates and canonical workbook facts are unchanged. All new references remain outside the public map.']}
    coverage = []
    for pair in sorted({tuple(c['country_pair']) for c in directory}):
        subset = [c for c in directory if tuple(c['country_pair']) == pair]
        coverage.append({'country_pair': list(pair), 'documented_references': len(subset),
            'supported': sum(c['candidate_match_status'] == 'supported' for c in subset),
            'provisional': sum(c['candidate_match_status'] == 'provisional' for c in subset),
            'not_located': sum(c['candidate_match_status'] == 'not_found' for c in subset)})
    summary['benchmark_recovery_by_frontier'] = coverage
    write(out / 'crossing-register.json', {'schema_version': 1, 'crossings': directory})
    write(out / 'event-crossing-links.json', {'schema_version': 1, 'links': links})
    write(out / 'candidate-review.json', rows)
    write(out / 'source-index.json', {'documents': sorted(documents.values(), key=lambda s: s['id']),
        'source_claims': source_entries,
        'note': 'Regional aliases resolve to one document URL. Unique URLs are not necessarily independent witnesses or independent measurements.'})
    write(out / 'review-summary.json', summary)
    write(out / 'road-exceptions.json', {'schema_version': 1, 'exceptions': road_exceptions})
    write(out / 'focused-extraction-lineage.json', lineage)
    write(out / 'reviewed-crossing-references.geojson', {'type': 'FeatureCollection',
        'features': [{'type': 'Feature', 'id': c['id'],
            'geometry': {'type': 'Point', 'coordinates': c['osm_reference_coordinate']} if c['osm_reference_coordinate'] else None,
            'properties': {k: c[k] for k in ('id', 'canonical_name', 'country_pair', 'mode', 'candidate_match_status',
                'coordinate_status', 'coordinate_accuracy_m', 'current_operation_status', 'source_urls', 'is_closure_evidence')}} for c in directory],
        'attribution': 'OSM-derived reference coordinates © OpenStreetMap contributors, ODbL 1.0; independent source points retained separately.'})
    csv_write(out / 'crossing-register.csv', directory, ['id', 'canonical_name', 'country_pair', 'mode', 'aliases',
        'existence_status', 'candidate_match_status', 'candidate_ids', 'osm_reference_coordinate',
        'external_reference', 'external_coordinates', 'mode_status', 'transport_mode_evidence', 'global_scope', 'coordinate_status', 'match_reason', 'source_urls', 'notes', 'current_operation_status'])
    csv_write(out / 'major-road-review.csv', major, list(major[0]))
    csv_write(out / 'main-road-priority-review.csv', [r for r in rows if r['global_scope'] != 'background_only'], list(rows[0]))
    csv_write(out / 'event-crossing-links.csv', links, ['id', 'event_id', 'crossing_id', 'crossing_name', 'mode',
        'link_status', 'scope', 'affected_movement', 'direction', 'phase_ids', 'coordinate_status',
        'supported_candidate_ids', 'unresolved_candidate_ids', 'source_urls', 'notes', 'published_on_map'])
    csv_write(out / 'retired-name-assignments.csv', evidence['rejected_candidate_links'],
        ['event_id', 'candidate_id', 'basis', 'reason', 'evidence_source_ids', 'rejection_scope'])
    csv_write(out / 'benchmark-recovery.csv', coverage, list(coverage[0]))
    inputs = [pilot / 'crossing-candidates.geojson', pilot / 'summary.json',
        out / 'event-link-review.json', out / 'topology-diagnostics.json', out / 'scope-policy.json', *[p for p, _ in benchmarks]]
    inputs += [ROOT / 'scripts' / name for name in ['build-osm-review.py', 'osm-crossings.py', 'osm-review-topology.py']]
    if focused_path.exists():
        inputs += [focused_path, focused_path.with_name('summary.json')]
    write(out / 'review-provenance.json', {'workbook_sha256': baseline['workbook_sha256'],
        'canonical_data_sha256': digest(args.data), 'input_sha256': {str(p.relative_to(ROOT)): digest(p) for p in inputs},
        'osm_source': baseline['source'], 'osm_data_timestamp': baseline['osm_data_timestamp'],
        'review_basis': 'Source-reviewed benchmark input files carry stable identity IDs. Rebuilds never generate new accepted event links from names or distance.'})
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot', type=Path, default=ROOT / 'research/osm/uganda-pilot')
    parser.add_argument('--output', type=Path, default=ROOT / 'research/osm/uganda-review')
    parser.add_argument('--data', type=Path, default=ROOT / 'dist/data.js')
    build(parser.parse_args())
