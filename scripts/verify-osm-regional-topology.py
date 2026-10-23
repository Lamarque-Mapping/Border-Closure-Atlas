#!/usr/bin/env python3
"""Regressions for fresh regional topology snapshots and open frontiers."""
import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

from shapely.geometry import LineString, Point, mapping

spec = importlib.util.spec_from_file_location('regional_topology', Path(__file__).with_name('osm-review-topology.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def route(wid, coordinates, nodes=None, **tags):
    return {'osm_id': wid, 'coordinates': coordinates,
            'nodes': nodes or [wid * 100 + i for i in range(len(coordinates))],
            'mode': 'road', 'tags': {'highway': 'primary', **tags}}


def fails(call, message):
    try:
        call()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError(f'Expected validation failure containing {message!r}')


# Oppositely digitized source members form one continuously oriented frontier;
# a crossing on either side of the member join receives the same diagnosis.
borders = [LineString([(0, -10000), (0, 0)]), LineString([(0, 10000), (0, 0)])]
roads = [route(1, [(-500, -2000), (500, -2000)]), route(2, [(-500, 2000), (500, 2000)])]
topology = module.Topology(None, borders, roads)
assert len(topology.components) == 1
assert topology.sides([(-500, -2000), (-500, 2000)])[0][0] == topology.sides([(-500, -2000), (-500, 2000)])[1][0]
assert all(topology.contact(r['osm_id'], Point(0, r['coordinates'][0][1]))['status'] == 'sustained_country_transition' for r in roads)

# A contact near an incomplete frontier endpoint is not a confirmed transition.
endpoint = route(3, [(-500, 9500), (500, 9500)])
diagnostic = module.Topology(None, borders, [endpoint]).contact(3, Point(0, 9500))
assert diagnostic['status'] == 'unresolved'
assert diagnostic['reason'] == 'frontier_endpoint_or_extract_edge'
# Unknown sides beyond an endpoint are not a boundary-band corridor.
beyond_endpoint = route(5, [(-500, 10500), (500, 10500)])
topology = module.Topology(None, borders, [beyond_endpoint])
assert not module.corridor_band_interval(topology, topology.routes[5]['line'], 0, 1000)

# At a branched boundary, line merging leaves branches as separate components.
# A crossing within the trace distance of their junction must remain unresolved.
branched = borders + [LineString([(0, 0), (10000, 0)])]
near_branch = route(4, [(-500, 500), (500, 500)])
assert module.Topology(None, branched, [near_branch]).contact(4, Point(0, 500))['status'] == 'unresolved'

# Santa Teresa regression: a road reference changes across the frontier. A
# same-ref return branch cannot hide the different-ref international branch.
approach = route(10, [(-500, 0), (0, 0)], [1001, 634226423], ref='NM 136')
international = route(11, [(0, 0), (500, 0)], [634226423, 1102], ref='MEX 2')
returning = route(12, [(0, 0), (-500, 100)], [634226423, 1202], ref='NM 136')
modern = module.Topology(None, borders, [approach, international, returning])
assert {option[0] for option in modern.continuation_options(approach, 1)} == {11, 12}
diagnostic = modern.contact(10, Point(0, 0))
assert diagnostic['status'] == 'unresolved'
assert {path['side'] for path in diagnostic['arms'][1]['paths']} == {-1, 1}
legacy = module.Topology(None, borders, [approach, international, returning], {'continuation_policy': 'legacy_ref_name_preference'})
assert {option[0] for option in legacy.continuation_options(approach, 1)} == {12}
assert legacy.contact(10, Point(0, 0))['status'] == 'same_country_return'
assert module.Topology(None, borders, [approach, international]).contact(10, Point(0, 0))['status'] == 'sustained_country_transition'

# Connectivity must also be respected at interior source-way nodes, rather
# than tracing straight through a fork until the source way's far endpoint.
through = route(20, [(-500, 0), (50, 0), (500, 0)], [2001, 2002, 2003], ref='A')
interior_return = route(21, [(50, 0), (-500, 100)], [2002, 2102], ref='B')
diagnostic = module.Topology(None, borders, [through, interior_return]).contact(20, Point(0, 0))
assert diagnostic['status'] == 'unresolved'
assert {path['side'] for path in diagnostic['arms'][1]['paths']} == {-1, 1}


def feature(wid=30, bid=40, coordinate=None):
    return {'type': 'Feature', 'id': 'fixture-candidate',
            'geometry': mapping(Point(coordinate or [0, 0])),
            'properties': {'route_osm_ids': [wid], 'boundary_osm_ids': [bid],
                           'raw_contact_count': 1,
                           'raw_contacts': [{'route_osm_id': wid, 'boundary_osm_id': bid, 'coordinate': coordinate or [0, 0]}],
                           'country_relations': [{'osm_relation_id': 100, 'iso2': 'AA'}, {'osm_relation_id': 200, 'iso2': 'BB'}],
                           'mode': 'road', 'road_tiers': ['major'], 'review_flags': []}}


ll_route = route(30, [(-.01, 0), (.01, 0)])
boundary = {'type': 'Feature', 'geometry': mapping(LineString([(0, -.1), (0, .1)])),
            'properties': {'osm_type': 'w', 'osm_id': 40}}
identity = lambda x, y: (x, y)
contact = module.explicit_contacts([feature()], {30: ll_route}, [boundary], identity)
assert len(contact) == 1 and contact[0]['candidate_id'] == 'fixture-candidate'
# The contact still lies on its road, but a substituted boundary is invalid.
wrong_boundary = copy.deepcopy(boundary)
wrong_boundary['geometry'] = mapping(LineString([(.005, -.1), (.005, .1)]))
fails(lambda: module.explicit_contacts([feature()], {30: ll_route}, [wrong_boundary], identity), 'source road and boundary')
wrong_road = route(30, [(-.01, .005), (.01, .005)])
fails(lambda: module.explicit_contacts([feature()], {30: wrong_road}, [boundary], identity), 'source road and boundary')
wrong_count = feature()
wrong_count['properties']['raw_contact_count'] = 2
fails(lambda: module.explicit_contacts([wrong_count], {30: ll_route}, [boundary], identity), 'raw-contact count')
fails(lambda: module.explicit_contacts([feature(), feature()], {30: ll_route}, [boundary], identity), 'assigned more than once')

# End-to-end fresh snapshot: use only retained WGS84 evidence and node graph,
# publish provenance, preserve raw IDs, and reject accidental output overwrite.
with tempfile.TemporaryDirectory(prefix='regional-topology-') as directory:
    root = Path(directory)
    pilot, out = root / 'pilot', root / 'review'
    pilot.mkdir()
    summary = {'schema_version': 3, 'country_code': 'AA', 'neighbour_code': 'BB',
               'metric_crs': 'EPSG:3857', 'source': {'sha256': 'fixture-source'},
               'osm_data_timestamp': '2026-01-01T00:00:00Z', 'raw_intersection_points': 1,
               'coverage': {'is_partial': False}}
    context = {'schema_version': 2, 'country_code': 'AA', 'neighbour_code': 'BB',
               'source_sha256': 'fixture-source', 'metric_crs': 'EPSG:3857',
               'buffer_m': 1500, 'routes': [ll_route]}
    module.write_json(pilot / 'summary.json', summary)
    module.write_json(pilot / 'crossing-candidates.geojson', {'type': 'FeatureCollection', 'features': [feature()]})
    module.write_json(pilot / 'boundary-overlaps.json', [])
    with gzip.open(pilot / 'osm-reference-evidence.geojson.gz', 'wt') as handle:
        json.dump({'type': 'FeatureCollection', 'features': [boundary]}, handle)
    with gzip.open(pilot / 'osm-graph-context.json.gz', 'wt') as handle:
        json.dump(context, handle)
    args = argparse.Namespace(pilot=pilot, output=out, pbf=None, rebuild_context=False, allow_overwrite=False)
    module.build(args)
    result = json.loads((out / 'topology-summary.json').read_text())
    assert result['method_version'] == 'regional-topology-review-3'
    assert result['side_basis'] == 'continuous_frontier_component'
    assert result['by_topology_status'] == {'sustained_country_transition': 1}
    assert result['parameters']['continuation_policy'] == 'all_connected_same_mode_branches'
    assert result['source_osm_sha256'] == 'fixture-source'
    assert result['reviewer_sha256'] == hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    assert result['source_candidate_sha256'] == hashlib.sha256((pilot / 'crossing-candidates.geojson').read_bytes()).hexdigest()
    diagnostics = json.loads((out / 'topology-diagnostics.json').read_text())
    contacts = json.loads((out / 'topology-contacts.json').read_text())
    assert diagnostics[0]['raw_contact_ids'] == [contacts[0]['raw_contact_id']]
    assert not diagnostics[0]['is_verified_crossing'] and not diagnostics[0]['is_closure_evidence']
    fails(lambda: module.build(args), 'Topology output exists')
    args.output = root / 'different-review'
    context['source_sha256'] = 'substituted-source'
    with gzip.open(pilot / 'osm-graph-context.json.gz', 'wt') as handle:
        json.dump(context, handle)
    fails(lambda: module.build(args), 'source checksum differs')

print('Passed: open frontier orientation, endpoint/branch qualification, changed-ref and interior shared-node forks, explicit source-line validation, fresh no-PBF replay, provenance and overwrite protection.')
