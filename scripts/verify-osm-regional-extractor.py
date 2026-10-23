#!/usr/bin/env python3
"""Synthetic pair-scoped extraction, provenance, coverage and graph checks."""
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from xml.sax.saxutils import quoteattr

from shapely.geometry import LineString

spec = importlib.util.spec_from_file_location('crossings', Path(__file__).with_name('osm-crossings.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def write_fixture(path, *, missing=False, incomplete=False, nested=False, third=False):
    tags = lambda values: ''.join(f'<tag k={quoteattr(k)} v={quoteattr(v)}/>' for k,v in values.items())
    nodes = {1:(30,-.02),2:(30,.02),3:(30.01,-.02),4:(30.01,.02),
             10:(29.999,0),11:(30.011,0),12:(29.999,.01),13:(30.001,.01),
             14:(29.999,.015),15:(30.001,.015),16:(30.003,0),
             20:(30.1,0),21:(30.11,0)}
    xml = ['<osm version="0.6" generator="synthetic-regional-test">']
    for ident,(lon,lat) in nodes.items():
        xml.append(f'<node id="{ident}" lon="{lon}" lat="{lat}" version="1" timestamp="2026-01-01T00:00:00Z"/>')
    ways = [(100,[1,2],{}),(101,[3,4],{}),
            (200,[10,11],{'highway':'primary','ref':'A1'}),
            (201,[12,13],{'highway':'service'}),
            (202,[14,15],{'highway':'secondary'}),
            (203,[11,16],{'highway':'service'}),
            (204,[20,21],{'highway':'primary'})]
    if incomplete:
        ways.append((102,[1,999],{}))
    for ident,refs,values in ways:
        xml.append(f'<way id="{ident}" version="2" timestamp="2026-01-01T00:00:00Z">'+
                   ''.join(f'<nd ref="{ref}"/>' for ref in refs)+tags(values)+'</way>')
    pair_ids = [100] + ([102] if missing or incomplete else [])
    relations = [(300,'UG','Uganda',pair_ids+[101]),(301,'KE','Kenya',pair_ids),
                 (302,'TZ','Tanzania',[101]),(90333,'','Uganda - Kenya',[100])]
    if third:
        relations.append((303,'SS','South Sudan',[100]))
    for ident,code,name,refs in relations:
        values = {'boundary':'administrative','admin_level':'2','name:en':name}
        if code:
            values['ISO3166-1:alpha2'] = code
        members = ''.join(f'<member type="way" ref="{ref}" role="outer"/>' for ref in refs)
        if nested and ident == 300:
            members += '<member type="relation" ref="9999" role="outer"/>'
        xml.append(f'<relation id="{ident}" version="3" timestamp="2026-01-01T00:00:00Z">'+members+tags(values)+'</relation>')
    path.write_text('\n'.join(xml+['</osm>']))


def read_gzip(path):
    with gzip.open(path,'rt') as stream:
        return json.load(stream)


def extract(root, label, **changes):
    args = SimpleNamespace(**{'pbf':root/'source.osm', 'country_code':'UG', 'neighbour_code':'KE',
                             'output':root/label, 'data':root/'data.js', 'metric_crs':None,
                             'cluster_metres':75, 'download_manifest':None, 'road_scope':'main',
                             'include_nonroad':False, **changes})
    with contextlib.redirect_stdout(io.StringIO()):
        module.build(args)
    return args.output


def fails(callback, text):
    try:
        callback()
    except ValueError as error:
        assert text in str(error), (text,str(error))
    else:
        raise AssertionError(f'Expected failure containing {text!r}')


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    data = {'meta':{'source_sha256':'synthetic'},
            'events':[{'id':'TEST1','title':'Test closure','countries':['Uganda','Kenya']}],
            'locations':{'features':[]},'links':[]}
    (root/'data.js').write_text('window.BORDER_DATA = '+json.dumps(data)+';')
    write_fixture(root/'source.osm')
    output = extract(root,'main')
    summary = json.loads((output/'summary.json').read_text())
    features = json.loads((output/'crossing-candidates.geojson').read_text())['features']
    graph = read_gzip(output/'osm-graph-context.json.gz')
    assert summary['schema_version'] == 3 and graph['schema_version'] == 2
    assert summary['neighbour_code'] == 'KE' and summary['boundary_ways_selected'] == 1
    assert summary['coverage']['selected_by'] == 'shared_admin2_memberways'
    assert not summary['coverage']['is_partial']
    assert summary['extractor_sha256'] == hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    assert graph['source_sha256'] == summary['source']['sha256'] == hashlib.sha256((root/'source.osm').read_bytes()).hexdigest()
    assert graph['metric_crs'] == summary['metric_crs'] and graph['buffer_m'] >= 1500
    assert '+proj=aeqd' in graph['metric_crs']
    assert len(features) == 1 and features[0]['properties']['boundary_osm_ids'] == [100]
    props = features[0]['properties']
    assert [c['iso2'] for c in props['country_relations']] == ['UG','KE']
    assert props['boundary_relation_provenance'] == [300,301,90333]
    assert 'country_pair_incomplete_or_ambiguous' not in props['review_flags']
    assert props['raw_contacts'] == [{'coordinate':[30.0,0.0],'route_osm_id':200,'boundary_osm_id':100}]
    assert props['workbook_candidate_links'] == [] and not props['is_closure_evidence']
    routes = {r['osm_id']:r for r in graph['routes']}
    assert set(routes) == {200,201,202,203}, 'Minor context retained; distant road excluded'
    assert routes[203]['nodes'] == [11,16] and routes[200]['nodes'] == [10,11]
    assert routes[200]['candidate_eligible'] and not routes[201]['candidate_eligible']
    assert routes[200]['osm_version'] == 2 and routes[200]['osm_timestamp']
    assert routes[200]['tags']['ref'] == 'A1' and routes[200]['mode'] == 'road'
    assert all(len(r['nodes']) == len(r['coordinates']) for r in graph['routes'])
    evidence = read_gzip(output/'osm-reference-evidence.geojson.gz')['features']
    assert any(f['properties']['osm_id'] == 100 and f['geometry']['coordinates'] == [[30,-.02],[30,.02]] for f in evidence)
    again = extract(root,'repeat')
    assert json.loads((again/'crossing-candidates.geojson').read_text()) == json.loads((output/'crossing-candidates.geojson').read_text())
    fails(lambda:extract(root,'main'),'Output already contains')
    (root/'exceptions.json').write_text(json.dumps({'exceptions':[{'route_osm_ids':[202],
        'reason':'Documented named crossing','source_urls':['https://example.org/source']}]}))
    output = extract(root,'excepted',road_exceptions=root/'exceptions.json')
    assert json.loads((output/'summary.json').read_text())['candidate_count'] == 2
    write_fixture(root/'source.osm',third=True)
    output = extract(root,'third')
    p = json.loads((output/'crossing-candidates.geojson').read_text())['features'][0]['properties']
    assert len(p['country_relations']) == 3 and 'country_pair_incomplete_or_ambiguous' in p['review_flags']
    for label,options,key in [('missing',{'missing':True},'missing_member_ids'),
                              ('incomplete',{'incomplete':True},'incomplete_member_ids'),
                              ('nested',{'nested':True},'unsupported_nested_boundary_members')]:
        write_fixture(root/'source.osm',**options)
        fails(lambda:extract(root,label),'Incomplete or nested selected frontier')
        coverage = json.loads((root/label/'coverage.json').read_text())
        assert coverage['is_partial'] and coverage[key]
        output = extract(root,label+'-partial',allow_partial_boundary=True)
        assert json.loads((output/'summary.json').read_text())['coverage']['is_partial']
        assert all('partial_frontier_coverage' in f['properties']['review_flags']
                   for f in json.loads((output/'crossing-candidates.geojson').read_text())['features'])
    (root/'bad-manifest.json').write_text(json.dumps({'sha256':'0'*64}))
    fails(lambda:extract(root,'bad-hash',download_manifest=root/'bad-manifest.json'),'checksum')

for coordinates,message in [([(179,0),(-179,0)],'Antimeridian'),
                             ([(0,85),(1,86)],'polar'),
                             ([(-35,0),(35,0)],'2,500 km')]:
    fails(lambda:module.regional_projection([LineString(coordinates)]),message)
for crs in ['EPSG:4326','EPSG:2263']:
    fails(lambda:module.regional_projection([LineString([(30,0),(30,1)])],crs),'metre units')
print('Passed: shared-member frontier, bilateral provenance, genuine third-country ambiguity, graph node IDs and minor context, sourced exceptions, deterministic IDs, source hash, coverage failures/qualification, and regional metric guards.')
