#!/usr/bin/env python3
"""Rebuild every current atlas output from the replacement workbook."""
import argparse
import csv
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]

def export_tables(sheets, tables):
 tables.mkdir(parents=True,exist_ok=True)
 names={name:name.lower().replace(' ','_')+'.csv' for name in sheets}
 if len(set(names.values()))!=len(names):raise ValueError('Workbook sheet names collide as CSV filenames')
 # This is the generated tables directory. Removed source sheets must not leave
 # obsolete data in a later release; the current workbook is a replacement.
 for previous in tables.glob('*.csv'):
  if previous.name not in names.values():previous.unlink()
 manifest=[]
 for name,filename in names.items():
  rows=sheets[name]
  if name=='Register':
   header=next(i for i,row in enumerate(rows) if row and row[0]=='ID')
   rows=rows[header:]
  with (tables/filename).open('w',encoding='utf-8-sig',newline='') as f:
   writer=csv.writer(f)
   for row in rows:
    writer.writerow([("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v) for v in row])
  manifest.append({'sheet':name,'file':filename,'rows':len(rows)})
 (tables/'workbook_tables.json').write_text(json.dumps({'tables':manifest,
  'note':'All current workbook sheets are exported. Numbered rounds, initial audits and labelled historical snapshots retain their historical status; they do not override the current Register, Chronology phases or Follow-up review.'},ensure_ascii=False,indent=2)+'\n')
 return manifest

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--workbook',type=Path,default=ROOT/'source/Global_Border_Closures_Register_2016_2026.xlsx')
 p.add_argument('--output',type=Path,default=ROOT/'releases/current_public')
 p.add_argument('--skip-gis',action='store_true')
 a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
 web=out/'web';template=ROOT/('dist' if (ROOT/'dist').exists() else 'web')
 if template.resolve()!=web.resolve():shutil.copytree(template,web,dirs_exist_ok=True)
 subprocess.run([sys.executable,str(ROOT/'scripts/import-workbook.py'),'--workbook',str(a.workbook),'--output',str(web)],check=True)
 subprocess.run([sys.executable,str(ROOT/'scripts/build-analysis.py'),str(web)],check=True)
 subprocess.run(['node',str(ROOT/'scripts/build-web-data.cjs'),str(web)],check=True)
 subprocess.run([sys.executable,str(ROOT/'scripts/build-standalone.py'),str(web),str(out/'Border_Closures_Atlas.html')],check=True)
 data=json.loads((web/'data.js').read_text().split('=',1)[1].strip().rstrip(';'))
 for name,value in [('map_data',data),('normalized_events',{'meta':data['meta'],'events':data['events']}),('atlas_summary',data['meta']['atlas_summary'])]:
  (out/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
 spec=importlib.util.spec_from_file_location('workbook_import',ROOT/'scripts/import-workbook.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 sheets=module.read_workbook(a.workbook)
 export_tables(sheets,out/'tables')
 if not a.skip_gis:subprocess.run([sys.executable,str(ROOT/'scripts/build_gis.py'),str(out/'map_data.json'),str(out/'qgis')],check=True)
 print('All outputs rebuilt from '+str(a.workbook))
if __name__=='__main__':main()
