#!/usr/bin/env python3
"""Meaningful geometry regressions for conservative crossing review."""
import importlib.util
import json
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

spec = importlib.util.spec_from_file_location('topology_review', Path(__file__).with_name('osm-review-topology.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

polygon = Polygon([(-10000, -10000), (0, -10000), (0, 10000), (-10000, 10000)])
border = LineString([(0, -10000), (0, 10000)])


def route(wid, coords, nodes=None, mode='road', **tags):
    return {'osm_id': wid, 'coordinates': coords, 'nodes': nodes or [wid * 100 + i for i in range(len(coords))],
            'mode': mode, 'tags': {'highway': 'primary', **tags}}


straight = route(1, [(-500, 0), (500, 0)])
t = module.Topology(polygon, [border], [straight])
assert t.contact(1, Point(0, 0))['status'] == 'sustained_country_transition'

tangent = route(2, [(-500, 100), (0, 200), (-500, 300)])
t = module.Topology(polygon, [border], [tangent])
assert t.contact(2, Point(0, 200))['status'] == 'same_country_return'

# A wiggly road can cross a geometrical boundary repeatedly while staying
# within its uncertainty band. These contacts are one review corridor only.
wiggle = route(3, [(-10, 0), (10, 100), (-10, 200), (10, 300), (-10, 400)])
t = module.Topology(polygon, [border], [wiggle])
assert module.corridor_band_interval(t, t.routes[3]['line'], 0, t.routes[3]['line'].length)
assert t.contact(3, Point(0, 50))['status'] == 'unresolved'

# Genuine exits into clear opposite-country land separate crossing contacts;
# simply sharing a road is insufficient grounds for collapsing them.
excursion = route(4, [(-500, 0), (500, 0), (500, 500), (-500, 500)])
t = module.Topology(polygon, [border], [excursion])
assert t.contact(4, Point(0, 0))['status'] == 'sustained_country_transition'
assert t.contact(4, Point(0, 500))['status'] == 'sustained_country_transition'
assert not module.corridor_band_interval(t, t.routes[4]['line'], 500, 2000)

# Short split ways become meaningful only through actual shared OSM node IDs.
left = route(5, [(-500, 0), (0, 0)], [501, 502])
right = route(6, [(0, 0), (500, 0)], [502, 603])
t = module.Topology(polygon, [border], [left, right])
assert t.contact(5, Point(0, 0))['status'] == 'sustained_country_transition'
disconnected = route(6, [(0, 0), (500, 0)], [999, 603])
t = module.Topology(polygon, [border], [left, disconnected])
assert t.contact(5, Point(0, 0))['status'] == 'unresolved'

# Road and rail never connect just because a node is shared or colocated.
rail = route(6, [(0, 0), (500, 0)], [502, 603], mode='rail')
t = module.Topology(polygon, [border], [left, rail])
assert t.contact(5, Point(0, 0))['status'] == 'unresolved'

# A junction with routes reaching different sides remains ambiguous; no
# arbitrary branch is selected to turn a touch into a confirmed transition.
return_arm = route(7, [(0, 0), (-500, 100)], [502, 703])
t = module.Topology(polygon, [border], [left, right, return_arm])
assert t.contact(5, Point(0, 0))['status'] == 'unresolved'

# A narrow excursion represented by a vertex must not disappear between
# regular samples of the uncertainty-band check.
spike = route(8, [(0, 0), (31, 2), (0, 4)])
t = module.Topology(polygon, [border], [spike])
assert not module.corridor_band_interval(t, t.routes[8]['line'], 0, t.routes[8]['line'].length)

root = Path(__file__).resolve().parents[1]
review = root / 'research/osm/uganda-review'
if (review / 'topology-diagnostics.json').exists():
    rows = json.loads((review / 'topology-diagnostics.json').read_text())
    old = json.loads((root / 'research/osm/uganda-pilot/crossing-candidates.geojson').read_text())['features']
    assert {r['candidate_id'] for r in rows} == {f['id'] for f in old}
    assert len(rows) == 843 and sum(r['is_major_road'] for r in rows) == 76
    assert all(r['is_verified_crossing'] is False and r['is_closure_evidence'] is False for r in rows)
    contacts = json.loads((review / 'topology-contacts.json').read_text())
    assert len({c['raw_contact_id'] for c in contacts}) == len(contacts)
    group_data = json.loads((review / 'topology-review-groups.json').read_text())
    grouped = [cid for g in group_data['groups'] for cid in g['candidate_ids']]
    assert len(grouped) == 843 and len(set(grouped)) == 843
    old_by_id = {f['id']: f['properties'] for f in old}
    for g in group_data['groups']:
        assert len({old_by_id[cid]['mode'] for cid in g['candidate_ids']}) == 1
        assert len({tuple(sorted(x.get('iso2', '') for x in old_by_id[cid]['country_relations'])) for cid in g['candidate_ids']}) == 1
    a8 = [r for r in rows if 613417039 in old_by_id[r['candidate_id']]['route_osm_ids']]
    assert len(a8) == 19
    assert all(r['topology_status'] == 'boundary_alignment_or_repeated_contacts' for r in a8)

print('Passed: sustained transitions, tangencies, boundary-alignment corridors, separate genuine crossings, shared-node continuation, disconnected ways, mode separation, ambiguous forks and short excursions; frozen candidate integrity when outputs exist.')
