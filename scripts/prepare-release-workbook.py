#!/usr/bin/env python3
"""Validate/copy the checked-in two-tab reader and native release companions.

Local release preparation explicitly uses --bind-manifest after authoring the
reader. CI never authors/resaves XLSX or silently changes a release fingerprint.
"""
import argparse
import csv
import io
import json
import shutil
import zipfile
from release_common import (ROOT,DATA_PATH,MANIFEST_PATH,MODEL_PATH,READER_PATH,
    load_json,read_manifest,sha256,validate_native,validate_reader)

ZIP_PATH=ROOT/'source/Global_Border_Closures_Data_2016_2026.zip'
PUBLIC_JSON='Global_Border_Closures_Data_2016_2026.json.gz'

def csv_bytes(rows):
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    for row in rows:
        writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v for v in row])
    return b'\xef\xbb\xbf'+stream.getvalue().encode()

def companion_members(release,model,method):
    master=[]
    for source,links in zip(model['rows'],model['links']):
        row=list(source)
        for j in range(3): row[10+j]=links[j] if j<len(links) else None
        master.append(row)
    headers=release['native_headers']['Chronology phases']
    readme=(f"Global Border Closures Atlas — {method['release_id']}\n\n"
        "The two-tab Master workbook is the readable register. The native JSON keeps current records, phases, sources and reviewed release metadata.\n"
        "Supporting historical tables are explicitly labelled by native-table provenance; they are preserved history, not new current claims.\n"
        "The CSV files are projections. Use JSON for complete source/review histories and original-versus-current values.\n"
        "Held phases remain in the evidence but have no numeric duration. Policy dates, announced windows, observations and operational spells remain distinct.\n"
        "Geography references retained in the research envelope are historical inputs. The current scope/location review is supplied separately as crossing-map-review.json.\n"
        f"Canonical research state: {release['data_state_sha256']}\nNative release input SHA-256: {sha256(DATA_PATH)}\n")
    return {PUBLIC_JSON:DATA_PATH.read_bytes(),
        'Global_Border_Closures_Master_2016_2026.csv':csv_bytes([[c['name'] for c in model['columns']]]+master),
        'Global_Border_Closure_Phases_2016_2026.csv':csv_bytes([headers]+[[p[h] for h in headers] for p in release['tables']['Chronology phases']]),
        'release-method.json':(ROOT/'source/release-method.json').read_bytes(),
        'crossing-map-review.json':(json.dumps({**load_json(ROOT/'source/crossings/scope-review.json'),
            'geography':load_json(ROOT/'source/crossings/locations.json')},ensure_ascii=False,indent=2)+'\n').encode(),
        'border-status-review.json':(ROOT/'source/border-status-review.json').read_bytes(),
        'national-policy-evidence.json':(json.dumps({**load_json(ROOT/'source/national-policy-supplement.json'),
            **load_json(ROOT/'source/national-map-display.json'),'compatible_data_sha256':sha256(DATA_PATH),
            'release_id':method['release_id']},ensure_ascii=False,indent=2)+'\n').encode(),
        'README.txt':readme.encode()}

def zip_bytes(members):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,body in sorted(members.items()):
            info=zipfile.ZipInfo(name,(2026,10,25,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
            archive.writestr(info,body,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    return stream.getvalue()

def bind_manifest(release,reader_report):
    method=load_json(ROOT/'source/release-method.json');model=load_json(MODEL_PATH)
    # Do not produce a package from a stale overlay even in explicit bind mode.
    for name in ['scope-review.json','locations.json']:
        assert load_json(ROOT/'source/crossings'/name)['source_sha256']==sha256(DATA_PATH),'Reconcile current geography first'
    ZIP_PATH.write_bytes(zip_bytes(companion_members(release,model,method)))
    paths={'data':DATA_PATH,'reader':READER_PATH,'reader_model':MODEL_PATH,
        'methodology':ROOT/'source/release-method.json','overrides':ROOT/'source/release-overrides.json',
        'companion_zip':ZIP_PATH,'geography_reference':ROOT/'source/geography-reference.json',
        'crossing_scope':ROOT/'source/crossings/scope-review.json','crossing_locations':ROOT/'source/crossings/locations.json',
        'crossing_reconciliation':ROOT/'source/crossings/release-reconciliation.json',
        'national_policies':ROOT/'source/national-policy-supplement.json','national_display':ROOT/'source/national-map-display.json','status_review':ROOT/'source/border-status-review.json'}
    files={name:{'path':str(p.relative_to(ROOT)),'sha256':sha256(p),'bytes':p.stat().st_size} for name,p in paths.items()}
    fingerprint=files['data']['sha256']
    for name in ['crossing_scope','crossing_locations']:
        assert load_json(paths[name])['source_sha256']==fingerprint,'Geography must be reconciled before manifest binding'
    downloads={name:{'path':'downloads/'+filename,'sha256':files[key]['sha256'],'source_file':files[key]['path']}
        for name,key,filename in [('reader','reader',READER_PATH.name),('companion_json','data',PUBLIC_JSON),('companion_zip','companion_zip',ZIP_PATH.name)]}
    manifest={'schema_version':1,'release_id':method['release_id'],'release_date':method['release_date'],
        'data_state_sha256':release['data_state_sha256'],'counts':release['counts'],
        'files':files,'downloads':downloads,'reader_validation':reader_report,
        'national_supplement':{'policy_histories':7,'observations':18,'mapped_entry_bans':2,'included_in_land_statistics':False}}
    MANIFEST_PATH.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return read_manifest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind-manifest',action='store_true',help='Explicit local binding after the reader and geography are final')
    args=parser.parse_args();release=load_json(DATA_PATH)
    validate_native(release);report=validate_reader(release=release)
    manifest=bind_manifest(release,report) if args.bind_manifest else read_manifest()
    assert report==manifest['reader_validation'],'Reader validation does not match the bound release'
    downloads=ROOT/'dist/downloads';downloads.mkdir(parents=True,exist_ok=True)
    for item in manifest['downloads'].values():
        destination=ROOT/'dist'/item['path'];shutil.copyfile(ROOT/item['source_file'],destination)
        assert sha256(destination)==item['sha256']
    shutil.copyfile(MANIFEST_PATH,downloads/'release-manifest.json')
    print(json.dumps({'release_id':manifest['release_id'],'source_sha256':manifest['files']['data']['sha256'],
        'reader_sha256':manifest['files']['reader']['sha256'],'counts':manifest['counts'],'reader':report}))

if __name__=='__main__':main()
