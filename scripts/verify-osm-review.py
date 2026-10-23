#!/usr/bin/env python3
"""Cross-table evidence invariants for the reviewed Uganda reference package."""
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / 'research/osm/uganda-pilot'
REVIEW = ROOT / 'research/osm/uganda-review'
read = lambda p: json.loads(p.read_text())
original = read(PILOT / 'crossing-candidates.geojson')['features']
review = read(REVIEW / 'candidate-review.json')
crossings = read(REVIEW / 'crossing-register.json')['crossings']
links = read(REVIEW / 'event-crossing-links.json')['links']
evidence = read(REVIEW / 'event-link-review.json')
summary = read(REVIEW / 'review-summary.json')
sources = read(REVIEW / 'source-index.json')
documents = {d['id']: d for d in sources['documents']}
by_crossing = {c['id']: c for c in crossings}
assert len(by_crossing) == len(crossings) == 49
assert len(review) == 843 and len({r['candidate_id'] for r in review}) == 843
assert {r['candidate_id'] for r in review} == {f['id'] for f in original}
assert sum('major' in r['road_tiers'] for r in review) == 76
assert all(not r['is_closure_evidence'] and not r['published_on_map'] for r in review)
assert Counter(c['candidate_match_status'] for c in crossings) == {'supported': 16, 'provisional': 17, 'not_found': 16}
assert sum('major' in r['road_tiers'] and bool(r['supported_crossing_ids']) for r in review) == 14
assert len(links) == 8 and len({l['event_id'] for l in links}) == 6
assert len({l['crossing_id'] for l in links}) == 6
assert sum(bool(l['supported_candidate_ids']) for l in links) == 6
assert all(l['source_document_ids'] and set(l['source_document_ids']) <= documents.keys() for l in links)
assert not any(l['event_id'] in {'GL04', 'GL05'} for l in links), 'National scopes must not be expanded into assumed post closures'
assert not any(l['mode'] == 'rail' for l in links), 'Truck closure must not transfer to Malaba rail'
assert summary['global_scope_policy']['main_highway_classes'] == ['motorway', 'trunk', 'primary']
assert summary['original_candidates_in_focused_scope'] == {'main_road':36, 'targeted_named_exception':3, 'background_only':804}
assert by_crossing['UG-CD-KYESHERO-ROAD']['global_scope'] == 'background_reference_only'
assert by_crossing['UG-CD-BUSANZA-ROAD']['global_scope'] == 'targeted_named_exception'
assert by_crossing['UG-KE-LWAKHAKHA-ROAD']['global_scope'] == 'targeted_named_exception'
fresh = read(REVIEW / 'main-road-extraction/crossing-candidates.geojson')['features']
assert len(fresh) == summary['focused_extraction_candidates'] == 39
assert all(not f['properties']['workbook_candidate_links'] for f in fresh)
assert all(not f['properties']['is_closure_evidence'] for f in fresh)
fresh_summary = read(REVIEW / 'main-road-extraction/summary.json')
assert fresh_summary['road_scope'] == 'main' and fresh_summary['include_nonroad'] is False
assert not any('secondary' in f['properties']['highway_classes'] and 607402412 not in f['properties']['route_osm_ids'] for f in fresh)
assert not any(1528070453 in f['properties']['route_osm_ids'] for f in fresh), 'Private Malaba track is outside the main-road extraction'
assert any(1528070456 in f['properties']['route_osm_ids'] for f in fresh), 'Keep the Malaba trunk bridge'
lineage = read(REVIEW / 'focused-extraction-lineage.json')
assert {l['focused_candidate_id'] for l in lineage} == {f['id'] for f in fresh}
assert all(l['original_candidate_ids'] and not l['carries_accepted_event_link'] for l in lineage)
for link in links:
    crossing = by_crossing[link['crossing_id']]
    assert link['mode'] == crossing['mode']
    assert sorted(link['country_pair']) == sorted(crossing['country_pair'])
    assert not link['published_on_map']
    if crossing['candidate_match_status'] != 'supported':
        assert not link['supported_candidate_ids']
assert by_crossing['UG-KE-MALABA-ROAD']['osm_reference_coordinate'] is None
assert by_crossing['UG-CD-BUSANZA-ROAD']['osm_reference_coordinate'] is None
assert by_crossing['UG-TZ-BUGANGO-ROAD']['osm_reference_coordinate'] is None
assert {l['crossing_id'] for l in links if l['event_id'] in {'R3-AF-006','R3-AF-007'}} == {'UG-SS-ELEGU-ROAD'}
assert all(l['supported_candidate_ids'] == ['osm-6a12feb9e54a44eb'] for l in links if l['event_id'] in {'R3-AF-006','R3-AF-007'})
assert next(l for l in links if l['crossing_id']=='UG-CD-BUSANZA-ROAD')['phase_ids'] == ['GL13-R1']
old_pairs = {(m['record_id'], f['id']) for f in original for m in f['properties']['workbook_candidate_links']}
retired = {(r['event_id'], r['candidate_id']) for r in evidence['rejected_candidate_links']}
retained = {(r['event_id'], r['candidate_id']) for r in evidence['retained_candidate_proposals']}
assert len(old_pairs) == 38 and len(retired) == 33 and len(retained) == 5
assert retired.isdisjoint(retained) and retired | retained == old_pairs
supported_pairs = {(l['event_id'], cid) for l in links for cid in l['supported_candidate_ids']}
assert retired.isdisjoint(supported_pairs)
for crossing in crossings:
    ref = crossing.get('external_reference')
    if ref:
        assert ref['observation_date'] is None, 'UNHCR publication date is not a survey date'
        assert ref['source_publication_date'] == '2021-05-20'
    assert not crossing['is_closure_evidence']
    assert crossing['current_operation_status'] == 'not_assessed'
    assert crossing['transport_mode_evidence']['formal_vehicle_access_verified'] is False
assert len(documents) == len({d['url'] for d in documents.values()}) == summary['sources_distinct_urls']
assert any(len(d['source_aliases']) == 3 and '86907' in d['url'] for d in documents.values())
provenance = read(REVIEW / 'review-provenance.json')
for name, expected in provenance['input_sha256'].items():
    content = (ROOT/name).read_bytes()
    # Frozen outputs pin the old producing code; new reusable code is tested
    # separately. Never rewrite past provenance to imply an unperformed rerun.
    if name in {'scripts/osm-crossings.py', 'scripts/osm-review-topology.py'} and hashlib.sha256(content).hexdigest() != expected:
        content = subprocess.check_output(['git', 'show', 'e61ce19c31c438102dcbb1d96c56e654ddf6b35e:' + name], cwd=ROOT)
    assert hashlib.sha256(content).hexdigest() == expected, name
# This is a frozen historical review. The replacement register is intentionally
# different; compare the historical identities to the pinned review inputs.
assert provenance['workbook_sha256'] == evidence['workbook_sha256'] == read(PILOT / 'summary.json')['workbook_sha256']
assert provenance['workbook_sha256'] == read(REVIEW / 'main-road-extraction/summary.json')['workbook_sha256']
combined = read(ROOT / 'research/osm/crossing-directory.json')
assert combined['historical_workbook_sha256'] == provenance['workbook_sha256']
assert combined['record_associations_status'] == 'historical_only_not_revalidated_for_replacement_workbook'
assert not any(r['accepted_event_link_ids'] for r in combined['records'])
subprocess.run(['git','diff','--exit-code','HEAD','--','research/osm/uganda-pilot'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
print('Passed: all 76 major candidates audited, frozen extraction retained, stable joins/source IDs, publication-date uncertainty, mode/scope separation, complete disposition of 38 old name associations, and historical workbook associations withheld from the replacement register.')
