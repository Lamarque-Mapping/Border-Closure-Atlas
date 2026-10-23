#!/usr/bin/env python3
"""Focused GIS/rebuild checks; no full release build or native QGIS needed."""
import copy
import csv
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/filename)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result
gis=module('gis_builder','build_gis.py');rebuild=module('release_builder','rebuild.py')
data=json.loads((ROOT/'dist/data.js').read_text().split('=',1)[1].strip().rstrip(';'))
by_id={e['id']:e for e in data['events']}
approved,intervals=gis.approved_phase_features(data['events'])
assert len(approved)==16
assert {f['properties']['period_id'] for f in intervals}=={'R3-AF-006-D1','R3-AF-007-D1'}
assert len({tuple(f['geometry']['coordinates']) for f in approved})==9

# A complete interval flag alone must not admit an unapproved, held, scheduled,
# last-observed, inclusive/unknown-endpoint or incomplete-bound phase.
base=copy.deepcopy(by_id['R3-AF-006'])
def rejected(change):
    event=copy.deepcopy(base);change(event['duration_periods'][0])
    assert not gis.approved_phase_features([event])[1]
for field,value in [('observed_reopening','No'),('observed_reopening','Unknown'),
                    ('endpoint_inclusion','Inclusive'),('endpoint_inclusion','Not recorded'),
                    ('contested',True),('measure_type','formal_policy_period'),
                    ('calculation_rule','withheld_observation_only')]:
    rejected(lambda p,f=field,v=value:p.__setitem__(f,v))
rejected(lambda p:p['source_phase'].__setitem__('Endpoint earliest',None))
rejected(lambda p:p['source_phase'].__setitem__('Start latest','2022-05-13'))
rejected(lambda p:p['location_bindings'][0].__setitem__('Binding decision','rejected_wrong_crossing'))
rejected(lambda p:p['location_bindings'][0].__setitem__('Temporal display rule','dated_evidence_only_no_continuity_inference'))
excluded=copy.deepcopy(base);excluded['inclusion_status']='Excluded'
assert gis.approved_phase_features([excluded])==([],[])

with tempfile.TemporaryDirectory(prefix='border-gis-check-') as folder:
    out=Path(folder)
    # Synthetic parent reference line deliberately differs from approved points.
    # It must remain static and never become an exact-phase closure footprint.
    sample=[copy.deepcopy(by_id[k]) for k in ['R3-AF-006','R3-AF-007','GL01','SC13']]
    for event in sample:event['location_ids']=[]
    sample[0]['location_ids']=['test-reference']
    empty={'type':'FeatureCollection','features':[]}
    fixture={'meta':data['meta'],'events':sample,'countries':empty,'borders':empty,
        'locations':{'type':'FeatureCollection','features':[{'type':'Feature',
            'properties':{'location_id':'test-reference','label':'Synthetic test reference','display_role':'frontier_context'},
            'geometry':{'type':'LineString','coordinates':[[0,0],[1,1]]}}]},
        'context_locations':empty,'links':[{'event_id':sample[0]['id'],'location_id':'test-reference'}],
        'crossing_contexts':[],
        'workbook_geography':{'phase_locations':[b for e in sample for p in e['duration_periods'] for b in p['location_bindings']]},
        'workbook_review':{'followup_review':[r for e in sample for r in e['followup_reviews']]}}
    report=gis.build(fixture,out/'gis')
    assert report['generalized_references_have_no_temporal_spans']
    assert report['approved_phase_markers']==5 and report['temporal_phase_features']==2
    with sqlite3.connect(out/'gis/border_closures_atlas.gpkg') as db:
        assert db.execute('SELECT start_dt,end_dt FROM event_context_lines').fetchall()==[(None,None)]
        assert db.execute('SELECT COUNT(*) FROM interval_points').fetchone()[0]==2
        assert not db.execute("SELECT name FROM sqlite_master WHERE name='interval_context_lines'").fetchall()
        assert db.execute('SELECT COUNT(*) FROM chronology_phases').fetchone()[0]==sum(len(e['duration_periods']) for e in sample)
        assert db.execute('SELECT COUNT(*) FROM workbook_phase_locations').fetchone()[0]==len(fixture['workbook_geography']['phase_locations'])
        assert db.execute('SELECT COUNT(*) FROM event_sources').fetchone()[0]==sum(len(e['sources']) for e in sample)
    project=ET.parse(out/'gis/border_closures_atlas.qgs').getroot()
    for node in project.findall('layer-tree-group/layer-tree-layer'):
        if 'points' in node.attrib['id']:assert node.attrib['checked']=='Qt::Unchecked'

    tables=out/'tables';tables.mkdir();(tables/'removed_old_sheet.csv').write_text('obsolete')
    sheets={'Register':[['Title'],['Summary'],['ID','Title'],['A','Current']],
            'Phase locations':[['Phase','Binding'],['P1','unlocated']],
            'Follow-up review':[['Record','Note'],['A','=formula-like source text']],
            'Country-year coverage':[['Country','Status'],['Rwanda','Partial']],
            'Release summary':[['Measure','Value'],['Parents',701]]}
    manifest=rebuild.export_tables(sheets,tables)
    assert {r['sheet'] for r in manifest}==set(sheets)
    assert not (tables/'removed_old_sheet.csv').exists()
    with (tables/'register.csv').open(encoding='utf-8-sig',newline='') as f:
        assert list(csv.reader(f))==[['ID','Title'],['A','Current']]
    with (tables/'follow-up_review.csv').open(encoding='utf-8-sig',newline='') as f:
        assert list(csv.reader(f))[1][1]=="'=formula-like source text"
print('GIS checks passed: 16 approved bindings, two strict temporal phases; no inherited line spans; '
      'held/unknown/rejected safeguards; GeoPackage/schema/QGS paths; all-sheet CSV replacement.')
