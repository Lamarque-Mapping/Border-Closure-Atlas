#!/usr/bin/env python3
"""Read both downloadable GIS packages through GDAL and reconcile to the release."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import zipfile
import fiona

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT/'dist/downloads'
manifest = json.loads((DOWNLOADS/'gis-downloads.json').read_text())
release = json.loads((ROOT/'source/current-release-manifest.json').read_text())
expected = json.loads(subprocess.check_output(['node', str(ROOT/'scripts/export-gis.cjs')]))
assert manifest['source_sha256'] == release['files']['data']['sha256']
assert manifest['counts']['records'] == release['counts']['records']
assert manifest['counts']['phases'] == release['counts']['phases']
assert manifest['counts']['included_records'] == release['counts']['included']
assert manifest['counts'] == expected['meta']['counts']
html = (ROOT/'dist/analysis.html').read_text()
assert f"{manifest['counts']['mapped_records']} of {manifest['counts']['included_records']} included records" in html
assert 'mapping work is incomplete' in html
audit_summary = json.loads((DOWNLOADS/'geography-audit-summary.json').read_text())
assert audit_summary['source_sha256'] == expected['meta']['source_sha256']
assert audit_summary['counts']['assigned_records'] == 387
assert (audit_summary['baseline']['mapped_records'] + audit_summary['counts']['newly_mapped_records']) == manifest['counts']['located_records']
assert audit_summary['counts']['border_reference_records'] == manifest['counts']['border_reference_only_records']
assert manifest['counts']['located_records'] + manifest['counts']['border_reference_only_records'] == manifest['counts']['mapped_records']
audit_zip = DOWNLOADS/'Global_Border_Closures_Geography_Audit.zip'
assert ('href="downloads/'+audit_zip.name+'?v='+hashlib.sha256(audit_zip.read_bytes()).hexdigest()+'"') in html
with zipfile.ZipFile(audit_zip) as z:
    assert z.testzip() is None
    assert json.loads(z.read('geography-audit-summary.json')) == audit_summary
    audit_rows = list(csv.DictReader(io.StringIO(z.read('geography-audit-records.csv').decode('utf-8-sig'))))
    assert len(audit_rows) == len({r['record_id'] for r in audit_rows}) == 387
    assert sum(r['border_reference_only'] == 'True' for r in audit_rows) == audit_summary['counts']['border_reference_records']
    reference_review = json.loads(z.read('border-reference-review.json'))
    assert reference_review == json.loads((ROOT/'source/crossings/border-reference-review.json').read_text())
    assert sum(r['both_passes_saved'] == 'True' for r in audit_rows) == audit_summary['counts']['both_passes_saved']
    assert len({b['record_id'] for b in reference_review['bindings']}) == audit_summary['counts']['border_reference_records']
    for d in [*json.loads(z.read('reconciled-decisions.json'))['decisions'], *reference_review['bindings']]:
        reviewers = []
        for ref in d['audit_passes']:
            key = ref['path'].split('geography-audit-2026-10-29/', 1)[1]
            raw = z.read(key)
            assert hashlib.sha256(raw).hexdigest() == ref['sha256']
            reviewers.append(json.loads(raw)['agent'])
        assert len(set(reviewers)) == 2

with tempfile.TemporaryDirectory(prefix='verify-atlas-gis-') as temp:
    folder = Path(temp)
    for format, item in manifest['downloads'].items():
        raw = (ROOT/'dist'/item['path']).read_bytes()
        assert len(raw) == item['bytes'] and len(raw) < 30*1024*1024
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
        assert 'href="'+item['path']+'?v='+item['sha256']+'"' in html
        assert 'download="'+Path(item['path']).name+'"' in html
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            assert z.testzip() is None
            assert json.loads(z.read('manifest.json')) == expected['meta']
            assert json.loads(z.read('research-method.json')) == expected['method']
            assert json.loads(z.read('geography-audit-summary.json')) == audit_summary
            assert 'last_confirmed is an observation date, NOT a reopening' in z.read('README.txt').decode()
            z.extractall(folder/format)
    gpkg = folder/'geopackage/Global_Border_Closures.gpkg'
    with sqlite3.connect(gpkg) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        for table, rows in expected['tables'].items():
            assert db.execute('SELECT count(*) FROM '+table).fetchone()[0] == len(rows)
            fields = [r[1] for r in db.execute('PRAGMA table_info('+table+')') if r[1] != 'fid']
            actual = [dict(zip(fields, row)) for row in db.execute('SELECT '+','.join('"'+f+'"' for f in fields)+' FROM '+table+' ORDER BY fid')]
            assert actual == [{key: row.get(key) for key in fields} for row in rows], table+' attributes must survive without truncation'
        assert db.execute('SELECT count(*) FROM records WHERE included=1 AND over_24h=1').fetchone()[0] == sum(row['included'] and row['over_24h'] for row in expected['tables']['records'])
        phase_ids = {row['phase_id'] for row in expected['tables']['phases']}
        for table, rows in expected['layers'].items():
            if not rows:
                continue
            gpkg_info = next(layer for layer in fiona.listlayers(gpkg) if layer == table)
            geojson = folder/'geojson'/(table+'.geojson')
            for source, kwargs in [(gpkg, {'layer': gpkg_info}), (geojson, {})]:
                with fiona.open(source, **kwargs) as layer:
                    assert layer.crs.to_epsg() == 4326
                    assert len(layer) == len(rows)
                    actual = list(layer)
                    assert len({row['properties']['feature_id'] for row in actual}) == len(rows)
                    for got, wanted in zip(actual, rows):
                        props = dict(got['properties'])
                        assert props == wanted['properties'], table+' attributes changed through GDAL'
                        assert props['phase_id'] in phase_ids and props['included'] == 1
                        geom = json.loads(json.dumps(fiona.model.to_dict(got['geometry'])))
                        target = wanted['geometry']
                        if geom['type'] == 'MultiLineString' and target['type'] == 'LineString':
                            target = {'type': 'MultiLineString', 'coordinates': [target['coordinates']]}
                        if geom['type'] == 'MultiPolygon' and target['type'] == 'Polygon':
                            target = {'type': 'MultiPolygon', 'coordinates': [target['coordinates']]}
                        assert geom == target, table+' geometry changed through GDAL'
        assert db.execute('SELECT count(*) FROM border_lines WHERE scope_category != "wider_border" AND map_representation != "border_reference"').fetchone()[0] == 0
        assert db.execute('SELECT count(DISTINCT record_id) FROM border_lines WHERE map_representation = "border_reference"').fetchone()[0] == manifest['counts']['border_reference_only_records']
        assert db.execute('SELECT count(*) FROM border_lines WHERE map_representation = "border_reference" AND (border_reference_qualification IS NULL OR geometry_note IS NULL)').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM crossing_points WHERE scope_category NOT IN ("single_site","multiple_named_sites")').fetchone()[0] == 0
        # Full sources and dates must remain usable, including text beyond DBF limits.
        assert db.execute('SELECT max(length(source_urls)) FROM records').fetchone()[0] > 255
        assert db.execute('SELECT count(*) FROM phases WHERE end_latest IS NULL').fetchone()[0] > 0
        assert db.execute('SELECT count(*) FROM unmapped_phases').fetchone()[0] > 0
    for table, rows in expected['tables'].items():
        with (folder/'geojson'/(table+'.csv')).open(encoding='utf-8-sig', newline='') as f:
            actual = list(csv.DictReader(f))
        assert len(actual) == len(rows)
        for got, wanted in zip(actual, rows):
            for key in got:
                value = wanted.get(key)
                value = '' if value is None else str(value)
                if value.startswith(('=', '+', '-', '@', '\t', '\r')):
                    value = "'"+value
                assert got[key] == value, table+' CSV value changed'
print('GIS downloads passed: both formats read through GDAL; all coordinates, dates, sources and full text reconciled; exclusions, unmapped records, duration flags, release hashes and public links checked.')
