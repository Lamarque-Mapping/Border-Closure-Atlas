#!/usr/bin/env python3
"""Reconcile audited phase applicability to the actual pinned public geography.

This command never edits native research data or invents coordinates. It reads
the original commit's scope/locations files, then the final native release and
explicit reviewer decisions. Default is a report-only check; --write binds the
three current geography files after the assembler has finished.
"""
import argparse,collections,copy,gzip,hashlib,json,re,subprocess,unicodedata
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def load(path):
 raw=Path(path).read_bytes();return json.loads(gzip.decompress(raw) if str(path).endswith('.gz') else raw)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def write(path,value):
 tmp=path.with_suffix(path.suffix+'.audit-tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)
def norm(value):
 return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(value or '')).encode('ascii','ignore').decode().lower()).strip()
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');parser.add_argument('--preview-patches',action='store_true',help='Inspect current patch coverage on the pinned baseline, without changing source files.');args=parser.parse_args()
 assert not(args.write and args.preview_patches),'Preview cannot write bound source files'
 inputs=load(ROOT/'migration/audit-inputs.json.gz');commit=inputs['baseline_commit']
 def original(path):return subprocess.check_output(['git','-C',str(ROOT),'show',commit+':'+path])
 old_scope_bytes=original('source/crossings/scope-review.json');old_locations_bytes=original('source/crossings/locations.json')
 old_scope=json.loads(old_scope_bytes);old_locations=json.loads(old_locations_bytes)
 base=json.loads(gzip.decompress(original('source/current-release.json.gz')))
 patches={};decisions={}
 for path in sorted((ROOT/'migration/phase-patches').glob('*.json')):
  for record in load(path)['records']:
   assert record['record_id'] not in patches,('Duplicate patch owner',record['record_id'])
   patches[record['record_id']]=record['phases']
   for phase in record['phases']:
    if phase.get('Geography decision'):
     assert phase['Phase ID'] not in decisions,phase['Phase ID'];decisions[phase['Phase ID']]=phase['Geography decision']
 if args.preview_patches:
  release=copy.deepcopy(base)
  grouped=collections.defaultdict(list)
  for p in base['tables']['Chronology phases']:grouped[p['Parent record ID']].append(p)
  release['tables']['Chronology phases']=[p for r in base['tables']['Register'] for p in patches.get(r['ID'],grouped[r['ID']])]
  for r in release['tables']['Register']:
   if r['ID']=='SA025':r['Analysis inclusion']='Included'
  fingerprint=None
 else:
  path=ROOT/'source/current-release.json.gz';release=load(path);fingerprint=sha(path.read_bytes())
  assert release['counts']=={'records':829,'included':826,'phases':1069},'Final audited native release must be assembled before binding geography'
  assert release.get('audit_integration',{}).get('baseline_commit')==commit
 included={r['ID'] for r in release['tables']['Register'] if r['Analysis inclusion']=='Included'}
 phases={p['Phase ID']:p for p in release['tables']['Chronology phases'] if p['Parent record ID'] in included and p.get('Analysis included (1=yes)',1)!=0}
 excluded={p['Phase ID'] for p in release['tables']['Chronology phases'] if p['Parent record ID'] not in included or p.get('Analysis included (1=yes)',1)==0}
 old={r.get('phase_id') or r['record_id']:r for r in old_scope['rows']};sites={s['id']:s for s in old_locations['sites']};old_bind=collections.defaultdict(list)
 for b in old_locations['bindings']:old_bind[b.get('phase_id') or b['record_id']].append(b)
 # Individually read old/new phase scope and the final audited crossing field.
 # These retain an existing named crossing, never select a new nearby point.
 named_existing={
  'ME005-R1':('post-trebil-karameh','Both old and new text explicitly name Trebil/Karameh; processing/cohort qualification changed.'),
  'SA003-C7P2':('post-chaman-friendship-gate','Both phases explicitly name Chaman; seven-day passenger arrangement does not move the gate.'),
  'SC12-D1':('post-tlokweng-kopfontein','Final policy-to-return interval is expressly assessed at Tlokweng, matching the retained original scoped endpoint.'),
  'R2-AM-006-D1':('post-pacaraima','Final scope expressly names Pacaraima formal migrant admission, matching the existing Brazilian-side reference.'),
  'R2-AM-007-D1':('post-san-ysidro-road','Same San Ysidro crossing-area reference; scope includes road lanes and PedEast, not an exact pedestrian lane footprint.'),
  'R2-AM-008-D1':('post-san-ysidro-road','Same San Ysidro incident crossing-area reference; different modal clocks do not create a new location.'),
  'R2-EU-005-D1':('post-brnjak','Final record crossing is Brnjak; phase now narrows direction to entry into Kosovo, with no crossing change.'),
  'R2-EU-006-D1':('post-jarinje','Final record crossing is Jarinje; phase now narrows direction to entry into Kosovo, with no crossing change.'),
  'R2-ME-010-R1':('post-erez-beit-hanoun','Both old and current phase identify Erez patient passage; the partial medical exception changes cohort/end meaning, not gate.'),
  'R5-AES-001-FU1':('post-golela-lavumisa','Both old and current scope explicitly name Golela exports; no transfer to another Eswatini crossing.'),
  'REC50-R02-003-P1':('post-hilsa-purang','Both scopes explicitly concern Indian pilgrims entering China via Hilsa; the approved Hilsa–Purang area is retained.'),
  'REC50-R07-002-P1':('post-agua-caliente-road','Both scopes identify Agua Caliente integrated post and Bailey-bridge works; Corinto is the diversion, not the closure point.')}
 for pid,(sid,note) in named_existing.items():
  if pid in decisions or pid not in phases:continue
  assert any(b['site_id']==sid for b in old_bind[pid]),('Explicit retention was not already bound',pid,sid)
  decisions[pid]={'category':old[pid]['category'],'site_ids':[sid],'note':note}
 categories={'single_site','multiple_named_sites','wider_border','needs_review'}
 stop={'crossing','border','bridge','terminal','international','road','rail','railway','passenger','cargo','commercial','freight','ferry','river','area','centre','center','north','south','east','west','main','gate','point','post','port','checkpoint','customs','service','route','system','of','and','the','de','la','el','san','los','las','del'}
 token_sites=collections.defaultdict(set)
 for sid,s in sites.items():
  for token in set(norm(s['name']).split())-stop:
   if len(token)>=5:token_sites[token].add(sid)
 def matches_site(sid,text,previous):
  s=sites[sid];new=norm(text);oldtext=norm(previous);name=norm(s['name'])
  # A railway change must not inherit a road terminal, or vice versa.
  rail=lambda t:bool(re.search(r'\b(rail|railway|train)\b',t)) and not re.search(r'\b(?:rail|railway) (?:excluded|excepted)\b',t)
  if rail(new)!=rail(oldtext) and (rail(new) or rail(oldtext)):return False
  # Different numbered bridges/checkpoints are not interchangeable.
  nums=lambda t:set(re.findall(r'\b(?:bridge|friendship bridge|checkpoint|crossing) (i{1,3}|iv|\d+)\b',t))
  if nums(name) and nums(new) and not nums(name)&nums(new):return False
  if name and name in new:return True
  return any(re.search(r'\b'+re.escape(token)+r'\b',new) for token in norm(s['name']).split() if len(token)>=5 and token not in stop and token_sites[token]=={sid})
 rows=[];bindings=[];review_queue=[];removed=[];new_decisions=[];changed_bindings=[]
 for pid,p in phases.items():
  rid=p['Parent record ID'];current=p['Movement / crossing / phase scope'];prior=old.get(pid);decision=decisions.get(pid) or p.get('Geography decision');prior_scope=prior.get('current_phase_scope') if prior else None
  inherited=copy.deepcopy(old_bind.get(pid,[]));reason='';site_ids=[];row=copy.deepcopy(prior or {})
  if decision:
   category=decision['category'];assert category in categories,(pid,category)
   site_ids=list(dict.fromkeys(decision.get('site_ids',[])));assert set(site_ids)<=set(sites),('Unapproved coordinate ID',pid,set(site_ids)-set(sites))
   assert category in ['single_site','multiple_named_sites'] or not site_ids,('Wider or unresolved phase cannot receive a point',pid)
   assert category!='single_site' or len(site_ids)<=1,('Single phase with several points',pid)
   reason=decision.get('note') or 'Explicit reviewer phase-scope decision.'
   row.update(category=category,note=reason,site_label=decision.get('site_label') or row.get('site_label'))
   if not prior:new_decisions.append({'phase_id':pid,**decision})
  elif not prior:
   row.update(category='needs_review',site_label=None,note='New audited phase has no separately approved geographic category/binding; retained without inferred coordinates or whole-frontier fallback.')
   reason=row['note'];review_queue.append({'phase_id':pid,'record_id':rid,'reason':reason,'current_scope':current,'previous_scope':None})
  else:
   category=prior['category'];assert category in categories
   if prior_scope==current:
    site_ids=[b['site_id'] for b in inherited];reason='Prior scope and binding applicability unchanged.'
   elif category in ['single_site','multiple_named_sites']:
    site_ids=[b['site_id'] for b in inherited if matches_site(b['site_id'],current,prior_scope)]
    reason='Same named crossing identity checked against revised phase scope; cohort/date changes do not supply new coordinates.'
    if len(site_ids)<len(inherited):
     review_queue.append({'phase_id':pid,'record_id':rid,'reason':'Changed phase scope does not safely confirm all old crossing bindings.','current_scope':current,'previous_scope':prior_scope,'withheld_site_ids':[b['site_id'] for b in inherited if b['site_id'] not in site_ids]})
   elif category=='wider_border':
    # Keep ordinary wider reference context unless the new statement expressly
    # narrows to a named local site; uncertain narrowing is queued, not geocoded.
    named=[sid for sid in sites if matches_site(sid,current,prior_scope)]
    if named and re.search(r'\b(?:only|single|specific|at the|through the)\b',norm(current)):
     row.update(category='needs_review',site_label=None);reason='Revised scope may be narrower than prior whole-border reference; explicit phase applicability review required.'
     review_queue.append({'phase_id':pid,'record_id':rid,'reason':reason,'current_scope':current,'previous_scope':prior_scope})
    else:reason='Existing wider border-reference classification retained; revised scope remains explicitly displayed and is not an enforcement footprint.'
   else:reason='Prior unresolved geography remains unresolved after audit.'
   row['note']=' '.join(x for x in [row.get('note'),reason] if x)
  row.update(record_id=rid,phase_id=pid,current_phase_scope=current,release_scope_decision='two_pass_audit_explicit' if decision else 'two_pass_audit_conservative_reconciliation',release_review_date='2026-10-26')
  rows.append(row)
  oldsites={b['site_id'] for b in inherited};newsites=set(site_ids)
  for sid in oldsites-newsites:removed.append({'phase_id':pid,'record_id':rid,'site_id':sid,'reason':reason})
  if prior_scope!=current and (oldsites or newsites):changed_bindings.append({'phase_id':pid,'record_id':rid,'retained_site_ids':site_ids,'reason':reason})
  for sid in site_ids:
   b=copy.deepcopy(next((b for b in inherited if b['site_id']==sid),{}))
   b.update(record_id=rid,phase_id=pid,site_id=sid,current_phase_scope=current,phase_scope_reviewed=current,review_date='2026-10-26',release_review_date='2026-10-26',release_applicability_note=reason,phase_source_urls=str(p.get('Source URLs') or '').splitlines())
   b['note']=' '.join(x for x in [b.get('note'),reason] if x)
   if row['category']=='multiple_named_sites':b['complete']=False
   elif 'complete' not in b:b['complete']=True
   bindings.append(b)
 undated=included-{p['Parent record ID'] for p in phases.values()}
 # An included parent with excluded phases is not an undated map record.
 has_any_phase={p['Parent record ID'] for p in release['tables']['Chronology phases']}
 undated-=has_any_phase
 for rid in sorted(undated):
  row=copy.deepcopy(old.get(rid,{'category':'needs_review','site_label':None,'note':'Undated parent without reviewed geography.'}));row.update(record_id=rid,phase_id=None,current_phase_scope=None,release_review_date='2026-10-26');rows.append(row)
  for b in old_bind.get(rid,[]):bindings.append(copy.deepcopy(b))
 bound={b['phase_id'] for b in bindings if b.get('phase_id')};counts=dict(collections.Counter(r['category'] for r in rows))
 report={'release_id':release.get('release_metadata',{}).get('release_id','2026.10.26-audit2'),'baseline_commit':commit,'data_state_sha256':release.get('data_state_sha256'),'source_sha256':fingerprint,'previous_scope_file_sha256':sha(old_scope_bytes),'previous_locations_file_sha256':sha(old_locations_bytes),'method':'Pinned public HEAD source files are the baseline. Explicit reviewer decisions take precedence; unchanged scopes and exact existing crossing identities can retain already sourced coordinates. New or ambiguous phase geography stays unlocated. No coordinate research or invented points.','new_coordinate_points':0,'screened_phases':len(phases),'excluded_phase_ids':sorted(excluded),'undated_records':len(undated),'mapped_phases':len(bound),'category_counts':counts,'new_decisions':new_decisions,'changed_existing_binding_applicability':changed_bindings,'removed_bindings':removed,'review_queue':review_queue,'reviewed_new_phases_since_github':sum(pid not in old for pid in phases),'new_scope_decisions_after_preserved_review':len(new_decisions),'additional_bindings_to_existing_sourced_sites':sum(not any(a['site_id']==b['site_id'] for a in old_bind.get(b['phase_id'],[])) for b in bindings if b.get('phase_id'))}
 new_scope=copy.deepcopy(old_scope);new_scope.update(source_sha256=fingerprint,review_date='2026-10-26',rows=rows,release_reconciliation=report)
 new_locations=copy.deepcopy(old_locations);new_locations.update(source_sha256=fingerprint,review_date='2026-10-26',bindings=bindings,release_reconciliation=report)
 new_locations['unlocated']=[{**r,'reason':r.get('note') or 'No phase-specific coordinate approved.'} for r in rows if r.get('phase_id') not in bound and r['category']!='wider_border']
 new_locations['unresolved']=copy.deepcopy(new_locations['unlocated'])
 new_locations['excluded_bindings']=old_locations.get('excluded_bindings',[])+removed
 assert new_locations['sites']==old_locations['sites'],'Coordinate/source catalogue changed'
 assert len(rows)==len(phases)+len(undated)
 assert len({r.get('phase_id') or r['record_id'] for r in rows})==len(rows)
 assert all(b.get('phase_id') in phases or b['record_id'] in undated for b in bindings)
 assert not any(b.get('phase_id') in excluded for b in bindings)
 report_path=ROOT/'migration'/('geography-preview.json' if args.preview_patches else 'geography-check.json');write(report_path,report)
 if args.write:
  assert fingerprint,'Cannot bind preview'
  directory=ROOT/'source/crossings'
  for name,obj in [('scope-review.json',new_scope),('locations.json',new_locations),('release-reconciliation.json',report)]:write(directory/name,obj)
 print(json.dumps({k:report[k] for k in ['screened_phases','undated_records','mapped_phases','new_coordinate_points','additional_bindings_to_existing_sourced_sites','category_counts']}|{'review_queue':len(review_queue),'written':bool(args.write),'report':str(report_path)}))
if __name__=='__main__':main()
