#!/usr/bin/env python3
"""Check review provenance and prevent uncertain geography becoming closure evidence."""
import copy
import csv
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

from osm_review_validation import validate_association_provenance, validate_batch_provenance, validate_no_publication

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'research/osm/international-review'
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def rejects(call, expected):
    try:
        call()
    except ValueError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError('Unsafe input accepted: ' + expected)


def main():
    data = read(BASE / 'review-summary.json')
    provenance = read(BASE / 'review-provenance.json')
    for relative, expected in provenance['input_sha256'].items():
        assert sha(ROOT / relative) == expected, relative
    frozen = read(ROOT / 'research/osm/uganda-review/review-provenance.json')
    assert provenance['workbook_sha256'] == frozen['workbook_sha256']
    assert provenance['canonical_data_sha256'] == frozen['canonical_data_sha256']
    assert provenance['record_associations_status'] == 'historical_only_not_revalidated_for_replacement_workbook'
    assert 'dist/data.js' not in provenance['input_sha256']
    directory_doc = read(ROOT / 'research/osm/crossing-directory.json')
    directory = {r['crossing_id']: r for r in directory_doc['records']}
    assert len(directory) == len(directory_doc['records']) == 98
    assert directory_doc['new_event_links_created'] == 0
    assert directory_doc['historical_uganda_event_link_count'] == 8
    assert directory_doc['point_display_enabled'] is False
    combined = read(BASE / 'candidate-review.json')
    by_candidate = {(r['pair'], r['candidate_id']): r for r in combined}
    assert len(combined) == len(by_candidate) == 81
    coverage = {r['pair']: r for r in read(BASE / 'coverage-by-frontier.json')}
    new_ids, pending_ids, candidate_count, contacts = set(), set(), 0, 0
    for batch in read(BASE / 'batch-manifest.json')['batches']:
        pair = batch['pair']
        extraction, topology = ROOT / batch['output'], ROOT / batch['topology_output']
        bp, ap = BASE / f'benchmarks/{pair}.json', BASE / f'associations/{pair}.json'
        cp, dp = extraction / 'crossing-candidates.geojson', topology / 'topology-diagnostics.json'
        benchmark, associations = read(bp), read(ap)
        summary, topo = read(extraction / 'summary.json'), read(topology / 'topology-summary.json')
        features = {f['id']: f for f in read(cp)['features']}
        diagnostics = {d['candidate_id']: d for d in read(dp)}
        validate_batch_provenance(ROOT, batch, benchmark, summary, topo, features, diagnostics, provenance['workbook_sha256'])
        validate_association_provenance(associations, bp, cp, dp, summary, topo)
        assert summary['coverage']['is_partial'] is False
        with gzip.open(extraction / 'osm-graph-context.json.gz', 'rt') as stream:
            graph = {r['osm_id']: r for r in json.load(stream)['routes']}
        allowed = {i for e in summary['targeted_road_exceptions'] for i in e['route_osm_ids']}
        for cid, feature in features.items():
            p = feature['properties']
            assert p['mode'] == 'road' and not p['workbook_candidate_links']
            for wid in p['route_osm_ids']:
                route = graph[wid]
                assert route['candidate_eligible']
                assert route['tags'].get('highway') in summary['road_classes'] or wid in allowed
            assert by_candidate[pair, cid]['topology_status'] == diagnostics[cid]['topology_status']
        refs = {r['crossing_id']: r for r in benchmark['crossings']}
        sources = {s['source_id']: s for s in benchmark['sources']}
        assert {a['crossing_id'] for a in associations['associations']} == refs.keys()
        for a in associations['associations']:
            ident = a['crossing_id']; ref, output = refs[ident], directory[ident]
            new_ids.add(ident)
            proposed = [p['candidate_id'] for p in a.get('related_candidate_proposals', [])]
            assert output['candidate_ids'] == a['candidate_ids']
            assert output['provisional_component_candidate_ids'] == proposed
            assert output['source_urls'] == sorted({sources[s]['url'] for s in set(ref['source_ids']) | set(a.get('source_ids', []))})
            pending = sorted(set(proposed + [c for c in a['candidate_ids'] if diagnostics[c]['topology_status'] != 'sustained_country_transition']))
            assert output['geometry_review_candidate_ids'] == pending
            assert output['geometry_review_required'] == bool(pending)
            if pending: pending_ids.add(ident)
            validate_no_publication(output)
            assert output['exact_gate_verified'] is False and output['current_operation_verified'] is False
        candidate_count += len(features); contacts += summary['raw_intersection_points']
        expected_topology = {'KE-TZ': {'unresolved': 6}, 'DE-FR': {'sustained_country_transition': 14, 'unresolved': 7}, 'MX-US': {'sustained_country_transition': 28, 'unresolved': 22}, 'KE-SO': {'sustained_country_transition': 2, 'unresolved': 2}}
        assert topo['by_topology_status'] == expected_topology[pair]
        assert coverage[pair]['candidate_groups'] == len(features)
        assert coverage[pair]['raw_contacts'] == summary['raw_intersection_points']
        assert coverage[pair]['topology_status_counts'] == dict(Counter(d['topology_status'] for d in diagnostics.values()))
        # Negative controls: stale review, changed input or promoted provisional
        # components must fail before a combined directory can be written.
        for field in ['benchmark_sha256', 'source_candidate_sha256', 'source_osm_sha256', 'topology_diagnostics_sha256', 'topology_reviewer_sha256', 'topology_method_version']:
            bad = copy.deepcopy(associations); bad[field] = 'stale'
            rejects(lambda: validate_association_provenance(bad, bp, cp, dp, summary, topo), field)
        for field, expected in [('source_graph_sha256', 'graph provenance'), ('source_evidence_sha256', 'boundary evidence provenance'), ('reviewer_sha256', 'stale topology code')]:
            bad = copy.deepcopy(topo); bad[field] = 'stale'
            rejects(lambda: validate_batch_provenance(ROOT, batch, benchmark, summary, bad, features, diagnostics, provenance['workbook_sha256']), expected)
        if pair == 'MX-US':
            proposals = [p for a in associations['associations'] for p in a.get('related_candidate_proposals', [])]
            assert len(proposals) == 3
            assert sum(bool(r['provisional_component_reference_ids']) for r in combined if r['pair'] == pair) == 3
            assert Counter(r['reference_review'] for r in combined if r['pair'] == pair) == {'associated_with_named_reference': 36, 'reviewed_provisional_component': 3, 'outside_reviewed_reference_sample': 11}
            bad = copy.deepcopy(associations)
            a = next(a for a in bad['associations'] if a.get('related_candidate_proposals'))
            a['candidate_ids'].append(a['related_candidate_proposals'][0]['candidate_id'])
            rejects(lambda: validate_association_provenance(bad, bp, cp, dp, summary, topo), 'Provisional component promoted')
    assert len(new_ids) == 49 and candidate_count == 81 and contacts == 310
    assert data['new_geography_statuses'] == {'supported_corridor': 44, 'provisional': 3, 'out_of_scope': 2}
    assert data['combined_geography_statuses'] == dict(Counter(r['geography_review_status'] for r in directory.values()))
    assert all(not r['published_on_map'] and not r['exact_gate_verified'] and not r['is_closure_evidence'] for r in directory.values())
    assert all(not r['accepted_event_link_ids'] for r in directory.values())
    assert sum(len(r.get('historical_event_link_ids', [])) for r in directory.values()) == 8
    assert directory_doc['historical_workbook_sha256'] == provenance['workbook_sha256']
    assert directory_doc['record_associations_status'] == 'historical_only_not_revalidated_for_replacement_workbook'
    assert all(not directory[i]['accepted_event_link_ids'] for i in new_ids)
    with (ROOT / 'research/osm/unresolved-crossing-references.csv').open(encoding='utf-8-sig') as stream:
        unresolved = {r['crossing_id'] for r in csv.DictReader(stream)}
    expected_unresolved = {i for i,r in directory.items() if r['geography_review_status'] != 'supported_corridor' or r['geometry_review_required']}
    assert unresolved == expected_unresolved and pending_ids <= unresolved
    for ident in ['UG-KE-BUSIA-ROAD', 'UG-CD-BUTOGO-ROAD']:
        assert directory[ident]['geography_review_status'] == 'supported_corridor'
        assert directory[ident]['geometry_review_required'] and ident in unresolved
    for flag in ['published_on_map', 'point_display_enabled', 'automatic_event_linking', 'is_closure_evidence', 'is_verified_crossing']:
        rejects(lambda: validate_no_publication({flag: True}), flag)
    for field in ['accepted_event_link_ids', 'accepted_event_links', 'accepted_event_crossing_links', 'workbook_candidate_links']:
        rejects(lambda: validate_no_publication({field: ['invented']}), field)
    print('Passed: four source-pinned batches, 49 new / 98 combined references, all 81 candidates / 310 contacts, explicit road exceptions, source URL union, pending Uganda geometry, provisional US components, zero new closure links, and rejection of stale or promoted evidence.')


if __name__ == '__main__':
    main()
