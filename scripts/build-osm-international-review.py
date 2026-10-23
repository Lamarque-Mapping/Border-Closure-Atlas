#!/usr/bin/env python3
"""Combine curated geography reviews without generating closure links."""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from osm_review_validation import (require, validate_association_provenance,
                                   validate_batch_provenance, validate_no_publication)

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'research/osm/international-review'
OSM = ROOT / 'research/osm'
read = lambda path: json.loads(path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def table(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore', quoting=csv.QUOTE_ALL, lineterminator='\n')
        writer.writeheader()
        for row in rows:
            values = {key: json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict)) else value for key, value in row.items()}
            values = {key: "'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value for key, value in values.items()}
            writer.writerow(values)


def main():
    manifest = read(BASE / 'batch-manifest.json')
    validate_no_publication(manifest)
    # Recombine frozen geometry research against its original source identity.
    # Its record links are historical and must not be promoted to a replacement register.
    frozen = read(OSM / 'uganda-review/review-provenance.json')
    workbook_sha256 = frozen['workbook_sha256']
    directory, candidates, coverage, sources = [], [], [], {}
    inputs = {BASE / 'batch-manifest.json', ROOT / 'scripts/osm-crossings.py',
              ROOT / 'scripts/osm-review-topology.py', ROOT / 'scripts/osm_review_validation.py'}
    for batch in manifest['batches']:
        pair = batch['pair']
        extraction, topology = ROOT / batch['output'], ROOT / batch['topology_output']
        paths = [BASE / 'benchmarks' / f'{pair}.json', BASE / 'associations' / f'{pair}.json',
                 extraction / 'summary.json', extraction / 'crossing-candidates.geojson',
                 topology / 'topology-diagnostics.json', topology / 'topology-summary.json']
        inputs.update(paths)
        benchmark, decisions, summary, features, diagnostics, topo_summary = map(read, paths)
        features = {f['id']: f for f in features['features']}
        diagnostics = {d['candidate_id']: d for d in diagnostics}
        inputs.update(validate_batch_provenance(ROOT, batch, benchmark, summary, topo_summary, features, diagnostics, workbook_sha256))
        validate_association_provenance(decisions, paths[0], paths[3], paths[4], summary, topo_summary)
        assocs = {a['crossing_id']: a for a in decisions['associations']}
        assert len(assocs) == len(decisions['associations'])
        assert assocs.keys() == {c['crossing_id'] for c in benchmark['crossings']}
        known_sources = {s['source_id']: s for s in benchmark['sources']}
        assert len(known_sources) == len(benchmark['sources'])
        named, provisional = defaultdict(list), defaultdict(list)
        dispositions = {d['candidate_id']: d for d in decisions.get('candidate_dispositions', [])}
        for source in benchmark['sources']:
            doc = sources.setdefault(source['url'], {'url': source['url'], 'source_ids': [], 'claims': []})
            doc['source_ids'].append(source['source_id'])
            doc['claims'].append(source)
        for ref in benchmark['crossings']:
            ident, assoc = ref['crossing_id'], assocs[ref['crossing_id']]
            ids = assoc.get('candidate_ids', [])
            proposal_ids = [p['candidate_id'] for p in assoc.get('related_candidate_proposals', [])]
            assert set(ids + proposal_ids) <= features.keys(), ident
            source_ids = set(ref['source_ids']) | set(assoc.get('source_ids', []))
            assert source_ids <= known_sources.keys(), ident
            for cid in ids:
                named[cid].append({'crossing_id': ident, 'match_status': assoc['match_status']})
            for cid in proposal_ids:
                provisional[cid].append(ident)
            pending = sorted(set(proposal_ids + [cid for cid in ids if diagnostics[cid]['topology_status'] != 'sustained_country_transition']))
            directory.append({
                'crossing_id': ident, 'name': ref['name'], 'country_pair': sorted(ref['country_pair']),
                'mode': ref['mode'], 'aliases': ref.get('aliases', []), 'reference_scope': ref.get('benchmark_role'),
                'geography_review_status': assoc['match_status'], 'candidate_ids': ids,
                'provisional_component_candidate_ids': proposal_ids,
                'geometry_review_required': bool(pending), 'geometry_review_candidate_ids': pending,
                'candidate_coordinates': [{'candidate_id': cid, 'coordinate': features[cid]['geometry']['coordinates'],
                                           'topology_status': diagnostics[cid]['topology_status']} for cid in ids],
                'external_reference_coordinate': ref.get('reference_coordinate'), 'coordinate_basis': ref.get('coordinate_basis'),
                'source_urls': sorted({known_sources[sid]['url'] for sid in source_ids}),
                'exact_gate_verified': False, 'current_operation_verified': False, 'is_closure_evidence': False,
                'accepted_event_link_ids': [], 'published_on_map': False,
                'review_package': str(paths[0].relative_to(ROOT)), 'reference': ref, 'association': assoc,
            })
        for cid, feature in features.items():
            props = feature['properties']
            assert sorted(c['iso2'] for c in props['country_relations']) == sorted(pair.split('-')), (pair, cid)
            assert not props['workbook_candidate_links'] and not props['is_closure_evidence'] and not props['is_verified_crossing']
            candidates.append({
                'pair': pair, 'candidate_id': cid, 'coordinate': feature['geometry']['coordinates'],
                'highway_classes': props['highway_classes'], 'route_refs': props['route_refs'],
                'route_osm_ids': props['route_osm_ids'], 'raw_contact_count': props['raw_contact_count'],
                'named_reference_associations': named[cid], 'provisional_component_reference_ids': provisional[cid],
                'reference_review': 'associated_with_named_reference' if named[cid] else 'reviewed_provisional_component' if provisional[cid] else 'outside_reviewed_reference_sample',
                'source_review_disposition': dispositions.get(cid, {}).get('disposition'),
                'topology_status': diagnostics[cid]['topology_status'],
                'topology_review_flags': diagnostics[cid].get('review_flags', []),
                'candidate_review_flags': props['review_flags'], 'review_group_id': diagnostics[cid].get('review_group_id'),
                'is_closure_evidence': False, 'published_on_map': False,
            })
        coverage.append({
            'pair': pair, 'batch_role': batch['batch_role'], 'osm_data_timestamp': summary['osm_data_timestamp'],
            'candidate_groups': len(features), 'raw_contacts': summary['raw_intersection_points'],
            'named_reference_entries': len(benchmark['crossings']),
            'association_status_counts': dict(Counter(a['match_status'] for a in assocs.values())),
            'topology_status_counts': dict(Counter(d['topology_status'] for d in diagnostics.values())),
            'loaded_boundary_members': summary['coverage']['loaded_member_count'],
            'expected_boundary_members': summary['coverage']['expected_member_count'],
            'partial_boundary_geometry': summary['coverage']['is_partial'],
            'candidates_outside_reference_sample': sum(not named[cid] and not provisional[cid] for cid in features),
            'provisional_component_candidates': sum(bool(provisional[cid]) for cid in features),
            'sourced_road_exception_count': len(summary['targeted_road_exceptions']),
            'all_crossings_complete': False, 'automatic_event_links': 0,
        })
    ug_path = OSM / 'uganda-review/crossing-register.json'
    ug_links_path = OSM / 'uganda-review/event-crossing-links.json'
    ug_diagnostics_path = OSM / 'uganda-review/topology-diagnostics.json'
    ug_topology_path = OSM / 'uganda-review/topology-summary.json'
    ug_candidates_path = OSM / 'uganda-pilot/crossing-candidates.geojson'
    ug_provenance_path = OSM / 'uganda-review/review-provenance.json'
    inputs.update({ug_path, ug_links_path, ug_diagnostics_path, ug_topology_path, ug_candidates_path, ug_provenance_path})
    ug_provenance, ug_topology = read(ug_provenance_path), read(ug_topology_path)
    require(ug_provenance['workbook_sha256'] == workbook_sha256, 'Frozen Uganda workbook differs')
    require(ug_topology['method_version'] == 'uganda-topology-review-1', 'Frozen Uganda topology method differs')
    require(ug_topology['source_candidate_sha256'] == sha(ug_candidates_path), 'Frozen Uganda candidate provenance differs')
    require(ug_topology['source_osm_sha256'] == ug_provenance['osm_source']['sha256'], 'Frozen Uganda OSM provenance differs')
    # The historical code hashes identify the frozen run; they deliberately do
    # not have to equal the current generalized extraction/review scripts.
    for relative, expected in ug_provenance['input_sha256'].items():
        if not relative.startswith('scripts/'):
            path = ROOT / relative
            require(sha(path) == expected, f'Frozen Uganda input differs: {relative}')
            inputs.add(path)
    ug_diagnostics = {d['candidate_id']: d for d in read(ug_diagnostics_path)}
    uganda, ug_links = read(ug_path)['crossings'], read(ug_links_path)['links']
    for ref in uganda:
        require(set(ref['candidate_ids']) <= ug_diagnostics.keys(), f"Frozen Uganda topology missing: {ref['id']}")
        pending = sorted(cid for cid in ref['candidate_ids'] if ug_diagnostics[cid]['topology_status'] != 'sustained_country_transition')
        directory.append({
            'crossing_id': ref['id'], 'name': ref['canonical_name'], 'country_pair': sorted(ref['country_pair']),
            'mode': ref['mode'], 'aliases': ref.get('aliases', []), 'reference_scope': ref.get('global_scope'),
            'geography_review_status': {'supported': 'supported_corridor', 'provisional': 'provisional', 'not_found': 'not_recovered'}[ref['candidate_match_status']],
            'candidate_ids': ref['candidate_ids'],
            'candidate_coordinates': [{**candidate, 'topology_status': ug_diagnostics[candidate['candidate_id']]['topology_status']} for candidate in ref.get('osm_candidates', [])],
            'provisional_component_candidate_ids': [],
            'geometry_review_required': bool(pending), 'geometry_review_candidate_ids': pending,
            'source_urls': ref['source_urls'], 'exact_gate_verified': False, 'current_operation_verified': False,
            'is_closure_evidence': False, 'accepted_event_link_ids': [],
            'historical_event_link_ids': [link['id'] for link in ug_links if link['crossing_id'] == ref['id']],
            'historical_workbook_sha256': workbook_sha256,
            'published_on_map': False, 'review_package': str(ug_path.relative_to(ROOT)), 'reference': ref,
        })
    directory.sort(key=lambda row: row['crossing_id'])
    assert len({row['crossing_id'] for row in directory}) == len(directory)
    assert len({(row['pair'], row['candidate_id']) for row in candidates}) == len(candidates)
    write(OSM / 'crossing-directory.json', {'schema_version': 1, 'scope': 'Named reference directory with uncertain and background entries; not a global census of crossings.', 'records': directory, 'new_event_links_created': 0, 'historical_uganda_event_link_count': len(ug_links), 'record_associations_status': 'historical_only_not_revalidated_for_replacement_workbook', 'historical_workbook_sha256': workbook_sha256, 'point_display_enabled': False})
    fields = ['crossing_id', 'name', 'country_pair', 'mode', 'reference_scope', 'geography_review_status',
              'geometry_review_required', 'geometry_review_candidate_ids', 'provisional_component_candidate_ids',
              'candidate_ids', 'source_urls', 'exact_gate_verified', 'current_operation_verified', 'accepted_event_link_ids', 'historical_event_link_ids', 'historical_workbook_sha256', 'published_on_map']
    table(OSM / 'crossing-directory.csv', directory, fields)
    unresolved = [row for row in directory if row['geography_review_status'] != 'supported_corridor' or row.get('geometry_review_required')]
    table(OSM / 'unresolved-crossing-references.csv', unresolved, fields + ['review_package'])
    write(BASE / 'candidate-review.json', candidates)
    table(BASE / 'candidate-review.csv', candidates, list(candidates[0]))
    table(BASE / 'geometry-review-queue.csv', [row for row in candidates if row['topology_status'] != 'sustained_country_transition' or row['reference_review'] != 'associated_with_named_reference'], list(candidates[0]))
    write(BASE / 'coverage-by-frontier.json', coverage)
    table(BASE / 'coverage-by-frontier.csv', coverage, list(coverage[0]))
    write(BASE / 'source-index.json', {'documents': list(sources.values()), 'note': 'URLs are deduplicated, not assumed independent witnesses or surveyed measurements.'})
    summary = {'new_frontier_batches': len(coverage), 'new_named_reference_entries': len(directory)-len(uganda),
               'combined_named_reference_entries': len(directory), 'candidate_groups': len(candidates),
               'raw_contacts': sum(row['raw_contacts'] for row in coverage),
               'combined_geography_statuses': dict(Counter(row['geography_review_status'] for row in directory)),
               'new_geography_statuses': dict(sum((Counter(row['association_status_counts']) for row in coverage), Counter())),
               'unique_new_source_urls': len(sources), 'new_event_links_created': 0,
               'global_crossing_completeness_measured': False, 'point_display_enabled': False}
    write(BASE / 'review-summary.json', summary)
    inputs.add(Path(__file__))
    write(BASE / 'review-provenance.json', {'workbook_sha256': workbook_sha256,
          'canonical_data_sha256': frozen['canonical_data_sha256'],
          'record_associations_status': 'historical_only_not_revalidated_for_replacement_workbook', 'input_sha256': {str(p.relative_to(ROOT)): sha(p) for p in sorted(inputs)},
          'note': 'Workbook and canonical hashes identify the superseded historical source; no equality to the current register is implied. Input hashes pin frozen geometry/review artifacts. Per-extraction and per-topology summaries identify their producing code.'})
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
