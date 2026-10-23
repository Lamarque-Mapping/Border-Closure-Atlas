#!/usr/bin/env python3
"""Synthetic geometry checks: no downloaded data or live services required."""
import importlib.util
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from shapely.geometry import Point

spec = importlib.util.spec_from_file_location('crossings', Path(__file__).with_name('osm-crossings.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# The first contact is the documented anchor, even if STRtree returns a
# neighbouring member first; a private bridge is not folded into a main road.
contacts = [{'point': Point(x, y), 'mode': 'road', 'pair': (1, 2),
             'route': {'tags': tags}} for x, y, tags in
            [(0, 0, {}), (0, -70, {}), (0, 70, {}), (1, 1, {'access': 'private'})]]
groups = module.cluster_contacts(contacts)
assert len(groups) == 2
assert groups[0][0] is contacts[0]
assert all(c['point'].distance(g[0]['point']) <= 75 for g in groups for c in g)
assert len(groups[1]) == 1 and groups[1][0]['route']['tags']['access'] == 'private'

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    nodes = {1:(30,-.03),2:(30,.03),10:(29.99,0),11:(30.01,0),12:(29.99,.0002),13:(30.01,.0002),
             20:(29.99,.01),21:(30,.01),22:(29.99,.015),30:(29.99,.02),31:(30,.02),32:(30.01,.02),
             40:(30,-.02),41:(30,-.01),50:(30.001,0),51:(30.002,0)}
    tags = lambda values: ''.join(f'<tag k="{k}" v="{v}"/>' for k,v in values.items())
    xml = ['<osm version="0.6" generator="synthetic-test">']
    for id, (x,y) in nodes.items():
        extra = {'barrier':'border_control','name':'Test Checkpoint'} if id==50 else {'place':'town','name':'Testville'} if id==51 else {}
        xml.append(f'<node id="{id}" lat="{y}" lon="{x}" version="1" timestamp="2026-01-01T00:00:00Z">{tags(extra)}</node>')
    ways = [(100,[1,2],{'boundary':'administrative','admin_level':'2'}),
            (200,[10,11],{'highway':'primary'}),(201,[12,13],{'highway':'primary'}),
            (202,[20,21,22],{'highway':'secondary'}),(203,[30,31],{'highway':'service'}),
            (204,[31,32],{'highway':'service'}),(205,[40,41],{'highway':'primary'})]
    for id, refs, attrs in ways:
        xml.append(f'<way id="{id}" version="1" timestamp="2026-01-01T00:00:00Z">'+''.join(f'<nd ref="{n}"/>' for n in refs)+tags(attrs)+'</way>')
    for id, code, name in [(300,'UG','Uganda'),(301,'KE','Kenya')]:
        xml.append(f'<relation id="{id}" version="1" timestamp="2026-01-01T00:00:00Z"><member type="way" ref="100" role="outer"/>'+tags({'type':'boundary','boundary':'administrative','admin_level':'2','ISO3166-1':code,'name:en':name})+'</relation>')
    xml.append('</osm>')
    (root/'test.osm').write_text('\n'.join(xml))
    data = {'meta':{'source_sha256':'synthetic'},'events':[{'id':'TEST1','title':'Test closure','countries':['Uganda','Kenya'],'crossings':'Testville'}], 'locations':{'features':[]},'links':[]}
    (root/'data.js').write_text('window.BORDER_DATA = '+json.dumps(data)+';')
    module.build(SimpleNamespace(pbf=root/'test.osm',country_code='UG',data=root/'data.js',output=root/'out',metric_crs=None,cluster_metres=75,download_manifest=None,road_scope='all',include_nonroad=True))
    result=json.loads((root/'out/crossing-candidates.geojson').read_text())['features']
    assert len(result)==3, 'Parallel lanes and split road endpoints should each group into one candidate; boundary-following road is excluded'
    assert sum('endpoint_or_tangent_contact' in f['properties']['review_flags'] for f in result)==1, 'Tangent contact must stay qualified; paired road endpoints cross the boundary'
    assert any(f['properties']['raw_contact_count']==2 for f in result)
    assert all(len(f['properties']['country_relations'])==2 for f in result)
    assert all(f['properties']['is_closure_evidence'] is False for f in result)
    assert all(f['properties']['is_verified_crossing'] is False for f in result)
    assert all(len(f['properties']['raw_contacts']) == f['properties']['raw_contact_count'] for f in result)
    assert all(f['properties']['workbook_candidate_links']==[] for f in result), 'Nearby towns must never create event-location links'
    assert all(f['properties']['workbook_name_suggestions'][0]['record_id']=='TEST1' for f in result)
    assert all(not m['eligible_for_automatic_acceptance'] for f in result for m in f['properties']['workbook_name_suggestions'])
    assert all('near Testville' in f['properties']['label'] for f in result), 'Nearby town is explicitly qualified'
    assert len(json.loads((root/'out/boundary-overlaps.json').read_text()))==1
    assert module.normal('Goma') != module.normal('Ngoma')
    # The global default stays on main roads. Secondary/minor roads only
    # enter through explicit sourced exceptions, rather than a proximity rule.
    scoped = SimpleNamespace(pbf=root/'test.osm',country_code='UG',data=root/'data.js',output=root/'main',metric_crs=None,cluster_metres=75,download_manifest=None,road_scope='main',include_nonroad=False)
    module.build(scoped)
    main = json.loads((root/'main/crossing-candidates.geojson').read_text())['features']
    assert len(main) == 1 and all(f['properties']['highway_classes'] == ['primary'] for f in main)
    (root/'exceptions.json').write_text(json.dumps({'exceptions':[{'route_osm_ids':[202], 'reason':'Synthetic sourced crossing', 'source_urls':['https://example.org/source']}]}))
    scoped.output = root/'exceptions'; scoped.road_exceptions = root/'exceptions.json'
    module.build(scoped)
    excepted = json.loads((root/'exceptions/crossing-candidates.geojson').read_text())['features']
    assert len(excepted) == 2
    assert any(f['properties']['highway_classes'] == ['secondary'] for f in excepted)
print('Passed: border intersections, lane grouping, tangent contacts, split-way continuation, linear overlaps, country pairs, provenance and discovery-only names; zero automatic event-location links.')
