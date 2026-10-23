#!/usr/bin/env python3
"""Small synthetic checks for the same-snapshot regional merge contract."""
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

import osmium

spec = importlib.util.spec_from_file_location('merge_osm',Path(__file__).with_name('merge-osm-extracts.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SNAPSHOT = '2026-01-02T00:00:00Z'


def fixture(path, second=False, change=None, snapshot=SNAPSHOT):
    attributes = {'version':1,'timestamp':'2026-01-01T00:00:00Z','uid':1,'user':'Test','changeset':10}
    header = osmium.io.Header()
    if snapshot:
        header.set('osmosis_replication_timestamp',snapshot)
    node_ids = [2,3] if second else [1,2]
    if change == 'unsorted':
        node_ids.reverse()
    if change == 'duplicate-input':
        node_ids = [2,2,3]
    with osmium.SimpleWriter(path,header=header) as writer:
        for ident in node_ids:
            values = {**attributes,'id':ident,'location':(30,ident/100)}
            if ident == 2 and change == 'coordinate':
                values['location'] = (30.001,.02)
            if ident == 2 and change == 'version':
                values['version'] = 2
            if ident == 2 and change == 'metadata':
                values['changeset'] = 11
            if ident == 2 and change == 'newer-object':
                values['timestamp'] = '2026-01-03T00:00:00Z'
            writer.add_node(osmium.osm.mutable.Node(**values))
        # Reversed tag serialization is semantically equal; topology order is not.
        tags = [('ref','A1'),('highway','primary')] if second else [('highway','primary'),('ref','A1')]
        if change == 'tags':
            tags = [('highway','service'),('ref','A1')]
        refs = [2,1] if change == 'way-order' else [1,2]
        writer.add_way(osmium.osm.mutable.Way(**attributes,id=10,nodes=refs,tags=tags))
        if second:
            writer.add_way(osmium.osm.mutable.Way(**attributes,id=11,nodes=[2,3],tags={'highway':'primary'}))
        members = [('w',10,'outer'),('w',11,'outer')]
        if change == 'relation-order':
            members.reverse()
        if change == 'relation-role':
            members[0] = ('w',10,'inner')
        writer.add_relation(osmium.osm.mutable.Relation(**attributes,id=20,members=members,tags={'boundary':'administrative','admin_level':'2'}))
    manifest = {'url':'https://example.org/'+path.name,'retrieved_at':'2026-01-02T01:00:00Z',
                'sha256':module.sha256(path),'bytes':path.stat().st_size}
    path.with_suffix('.download.json').write_text(json.dumps(manifest))


def fails(callback, expected, output):
    try:
        callback()
    except ValueError as error:
        assert expected in str(error),(expected,str(error))
    else:
        raise AssertionError(f'Expected failure containing {expected!r}')
    assert not output.exists() and not output.with_suffix('.download.json').exists()


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    first, second, output = root/'first.osm.pbf',root/'second.osm.pbf',root/'union.osm.pbf'
    fixture(first)
    fixture(second,second=True)
    manifest = module.merge([first,second],output)
    assert manifest['kind'] == 'checked_same_snapshot_regional_merge'
    assert manifest['osm_data_timestamp'] == SNAPSHOT
    assert manifest['entities_written'] == {'n':3,'w':2,'r':1}
    assert manifest['identical_duplicates_removed'] == {'n':1,'w':1,'r':1}
    assert manifest['conflicting_duplicates'] == 0
    assert manifest['sha256'] == module.sha256(output)
    assert manifest['merge_script_sha256'] == module.sha256(Path(module.__file__))
    assert manifest['inputs'][0]['sha256'] == module.sha256(first)
    assert manifest['inputs'][1]['url'].endswith(second.name)
    assert json.loads(output.with_suffix('.download.json').read_text()) == manifest
    reader = osmium.FileProcessor(output)
    assert reader.header.get('osmosis_replication_timestamp') == SNAPSHOT
    identities = [(item.type_str(),item.id) for item in reader]
    assert identities == [('n',1),('n',2),('n',3),('w',10),('w',11),('r',20)]
    old_hash = module.sha256(output)
    try:
        module.merge([first,second],output)
    except ValueError as error:
        assert 'already exists' in str(error)
    else:
        raise AssertionError('Existing snapshot must not be overwritten')
    assert module.sha256(output) == old_hash
    for change in ['coordinate','version','metadata','tags','way-order','relation-order','relation-role',
                   'newer-object','unsorted','duplicate-input']:
        other, target = root/(change+'.osm.pbf'),root/(change+'-output.osm.pbf')
        fixture(other,second=True,change=change)
        expected = ('newer than' if change == 'newer-object' else
                    'strictly sorted' if change in {'unsorted','duplicate-input'} else 'Conflicting duplicate')
        fails(lambda:module.merge([first,other],target),expected,target)
    for label,timestamp,expected in [('mismatch','2026-01-03T00:00:00Z','timestamps differ'),
                                      ('missing',None,'declare an osmosis_replication_timestamp')]:
        other, target = root/(label+'.osm.pbf'),root/(label+'-output.osm.pbf')
        fixture(other,second=True,snapshot=timestamp)
        fails(lambda:module.merge([first,other],target),expected,target)
    source_manifest = second.with_suffix('.download.json')
    original = json.loads(source_manifest.read_text())
    for label,value,expected in [('sha256','0'*64,'checksum mismatch'),('bytes',0,'byte count mismatch'),
                                 ('osm_data_timestamp','2026-01-03T00:00:00Z','manifest snapshot timestamp mismatch')]:
        source_manifest.write_text(json.dumps({**original,label:value}))
        target = root/('bad-'+label+'.osm.pbf')
        fails(lambda:module.merge([first,second],target),expected,target)
    assert not list(root.glob('.osm-merge-*')), 'Failure must clean staged output'
print('Passed: streaming regional union, exact duplicate payload and metadata checks, source checksum/size/provenance, timestamp guards, sorted snapshot enforcement, and failure cleanup without overwrites.')
