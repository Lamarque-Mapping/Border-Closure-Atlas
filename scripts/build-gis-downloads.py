#!/usr/bin/env python3
"""Build current, source-linked GIS downloads without changing research data."""
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
from build_gis import initialise, add_table
from build_geography_audit_report import build as build_geography_audit, NAME as AUDIT_NAME

ROOT = Path(__file__).resolve().parents[1]
NAMES = {'geopackage': 'Global_Border_Closures_GeoPackage.zip',
         'geojson': 'Global_Border_Closures_GeoJSON.zip'}
DESCRIPTIONS = {
    'crossing_points': 'Record-phase references at sourced approximate crossing locations; not physical obstruction footprints.',
    'border_lines': 'Wider-border geography and explicitly labelled known-border references; filter map_representation and inspect scope before interpreting extent.',
    'context_areas': 'Country/area context only, not an assertion that all crossings or a whole area were closed.',
    'records': 'All register records, including excluded and unmapped records. Count distinct record_id.',
    'phases': 'All dated and undated phase evidence; no inferred reopening or continuing closure.',
    'sources': 'Record-source associations with titles, URLs and labelled access histories where available.',
    'unmapped_phases': 'Included phases without reviewed display geometry, plus records without a dated phase.'}
KINDS = {'crossing_points': 'POINT', 'border_lines': 'MULTILINESTRING', 'context_areas': 'MULTIPOLYGON'}

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')

def table_csv(rows):
    fields = list(dict.fromkeys(k for row in rows for k in row))
    out = io.StringIO(newline='')
    writer = csv.writer(out)
    writer.writerow(fields)
    for row in rows:
        values = [row.get(k) for k in fields]
        # CSV files may also be opened in spreadsheet software.
        writer.writerow(["'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
    return b'\xef\xbb\xbf' + out.getvalue().encode('utf-8')

def archive(path, members):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, value in sorted(members.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 26, 0, 0, 0))
            info.external_attr = 0o644 << 16
            z.writestr(info, value, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

def build():
    data = json.loads(subprocess.check_output(['node', str(ROOT/'scripts/export-gis.cjs')]))
    output = ROOT/'dist/downloads'
    output.mkdir(parents=True, exist_ok=True)
    audit_members, geography_audit = build_geography_audit(output)
    tables = data['tables']
    layers = {name: rows for name, rows in data['layers'].items() if rows}
    counts = data['meta']['counts']
    coverage = (f"The map represents {counts['mapped_records']} of {counts['included_records']} included records "
                f"({100*counts['mapped_records']/counts['included_records']:.1f}%): "
                f"{counts['located_records']} have reviewed crossing or wider-policy geography, and "
                f"{counts['border_reference_only_records']} appear only as dotted border references because the "
                'affected border is established but the precise crossing or extent is unresolved. '
                'Dotted reference lines do not imply closure along the entire border. '
                f"The other {counts['included_records_without_geometry']} remain in the tables without spatial features; "
                'mapping work is incomplete. Coverage means at least one represented phase, '
                'not every phase or the selected month.')
    with tempfile.TemporaryDirectory(prefix='atlas-gis-') as temp:
        gpkg = Path(temp)/'Global_Border_Closures.gpkg'
        db = sqlite3.connect(gpkg)
        initialise(db)
        descriptors = []
        for name, rows in layers.items():
            descriptors.append(add_table(db, name, rows, DESCRIPTIONS[name], KINDS[name]))
        for name, rows in tables.items():
            descriptors.append(add_table(db, name, rows, DESCRIPTIONS[name]))
        add_table(db, 'release_metadata', [{'key': k, 'value': v} for k, v in data['meta'].items()], 'Release provenance and counts')
        add_table(db, 'research_method', [{'full_text': data['method']['full_text']}], 'Complete research and review account')
        db.execute('UPDATE gpkg_contents SET last_change=?', (data['meta']['snapshot_date']+'T00:00:00.000Z',))
        db.commit()
        db.execute('VACUUM')
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        db.close()
        readme = (ROOT/'scripts/GIS_DOWNLOAD_README.txt').read_text().replace('CURRENT MAPPING COVERAGE', coverage)
        common = {**audit_members, 'README.txt': readme.encode('utf-8'),
                  'manifest.json': encoded(data['meta']), 'fields.json': encoded(descriptors),
                  'research-method.json': encoded(data['method'])}
        archive(output/NAMES['geopackage'], {**common, gpkg.name: gpkg.read_bytes()})
        geojson = {name+'.geojson': encoded({'type': 'FeatureCollection', 'features': rows}) for name, rows in layers.items()}
        csvs = {name+'.csv': table_csv(rows) for name, rows in tables.items()}
        archive(output/NAMES['geojson'], {**common, **geojson, **csvs})
    manifest = dict(data['meta'], downloads={key: {'path': 'downloads/'+name,
        'sha256': hashlib.sha256((output/name).read_bytes()).hexdigest(), 'bytes': (output/name).stat().st_size}
        for key, name in NAMES.items()})
    (output/'gis-downloads.json').write_bytes(encoded(manifest))
    # Version actual download bytes, including exporter changes within a release.
    page = ROOT/'dist/analysis.html'
    html = page.read_text()
    html, count = re.subn(r'(<p class="figure-note" id="gis-coverage">).*?(</p>)',
                         lambda match: match[1]+coverage+match[2], html)
    assert count == 1, 'Dataset must disclose GIS coverage'
    audit_counts = geography_audit['counts']
    audit_text = (f"Geography audit: {audit_counts['both_passes_saved']} of {audit_counts['assigned_records']} "
                  'previously unmapped records have two separately saved AI source reconstructions; '
                  f"{audit_counts['reconciled_records']} have been reconciled, adding geography for "
                  f"{audit_counts['newly_mapped_records']} records. A subsequent border-level review adds dotted references for "
                  f"{audit_counts['border_reference_records']} further records while retaining their unresolved precise geography. "
                  'The audit download retains both reviews, source links, partial coverage and unresolved cases.')
    html, count = re.subn(r'(<p class="figure-note" id="geography-audit-coverage">).*?(</p>)',
                         lambda match: match[1]+audit_text+match[2], html)
    assert count == 1, 'Dataset must disclose geography audit coverage'
    audit_hash = hashlib.sha256((output/AUDIT_NAME).read_bytes()).hexdigest()
    html, count = re.subn(r'href="downloads/'+re.escape(AUDIT_NAME)+r'(?:\?v=[^"<> ]*)?"',
                         'href="downloads/'+AUDIT_NAME+'?v='+audit_hash+'"', html)
    assert count == 1, 'Dataset must expose geography audit download'
    for item in manifest['downloads'].values():
        pattern = re.escape(item['path']) + r'(?:\?v=[^"<> ]*)?'
        html, count = re.subn(r'href="'+pattern+r'"', 'href="'+item['path']+'?v='+item['sha256']+'"', html)
        assert count == 1, 'Dataset must expose one GIS link per format'
    page.write_text(html)
    print(json.dumps(manifest))
    return manifest

if __name__ == '__main__':
    build()
