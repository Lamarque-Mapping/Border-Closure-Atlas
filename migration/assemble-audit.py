#!/usr/bin/env python3
"""Integrate adjudicated reader + explicitly reviewed native phase patches.

The pinned Git commit is an immutable input, never the current output. No date
is inferred from the review date. This script does not fetch or reinterpret sources.
"""
import collections,copy,gzip,hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from release_common import validate_native

def write(path,value):
    raw=(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
    path.write_bytes(gzip.compress(raw,mtime=0) if path.suffix=='.gz' else raw)
def original(path):
    raw=subprocess.check_output(['git','-C',str(ROOT),'show',inputs['baseline_commit']+':'+path])
    return json.loads(gzip.decompress(raw) if path.endswith('.gz') else raw)
def groups(rows,key):
    out=collections.defaultdict(list)
    for r in rows:out[r[key]].append(r)
    return out
def norm_table(name,rows):
    headers=list(release['native_headers'].get(name,[]))
    for r in rows:
        for k in r:
            if k not in headers:headers.append(k)
    release['native_headers'][name]=headers
    release['tables'][name]=[{k:r.get(k) for k in headers} for r in rows]
    release['native_preambles'].setdefault(name,[])
    if name not in release['native_sheet_order']:release['native_sheet_order'].append(name)

inputs=json.loads(gzip.decompress((ROOT/'migration/audit-inputs.json.gz').read_bytes()))
release=original('source/current-release.json.gz');baseline=copy.deepcopy(release)
reader=inputs['reader'];byreader={r[0]:dict(zip(reader['columns'],r)) for r in reader['rows']}
catalogs=[p['accepted_changes'] for p in inputs['passes']]
changed={r['record_id'] for cat in catalogs for r in cat}
patches={}
for path in sorted((ROOT/'migration/phase-patches').glob('*.json')):
    for r in json.loads(path.read_text())['records']:
        assert r['record_id'] not in patches,('Duplicate patch owner',r['record_id'])
        patches[r['record_id']]=r
assert set(patches)==changed,('Patch coverage',sorted(changed-set(patches)),sorted(set(patches)-changed))
oldphases=groups(release['tables']['Chronology phases'],'Parent record ID')
phases=[]
for r in release['tables']['Register']:
    rid=r['ID'];rr=byreader[rid]
    included=rid not in {'GL18','SUP-004','R3-SC-004'}
    if included:r['Analysis inclusion']='Included'
    r['Closure or restriction episode']=rr['Closure or restriction']
    r['Current audit outcome']=rr['Latest verification']
    r['Current reviewed timing']=rr['Phase dates and scope']
    r['Current review location']='Current reader and full-register audit evidence; prior tables retain their historical review labels.'
    rows=copy.deepcopy(patches[rid]['phases'] if rid in patches else oldphases[rid])
    assert len(rows)==rr['Phases'],('Phase count differs from approved reader',rid,len(rows),rr['Phases'])
    assert {p['Phase ID'] for p in oldphases[rid]}.issubset(p['Phase ID'] for p in rows),('Removed historical phase',rid)
    for p in rows:
        assert p['Parent record ID']==rid
        p['Parent included (1=yes)']=int(included)
        p.setdefault('Analysis included (1=yes)',int(included))
        if p.get('Strictly over 24 hours') is not None:assert isinstance(p['Strictly over 24 hours'],bool),(rid,p['Phase ID'])
        if 'Strictly over 24 hours' in p and not p.get('Over 24 hours basis'):
            p['Over 24 hours basis']='Audited phase assessment; see phase evidence and qualification. Unknown does not qualify.'
        phases.append(p)
assert len(phases)==1069
norm_table('Chronology phases',phases)
release['counts']={'records':829,'included':826,'phases':1069}
release['audited_reader_by_record']=byreader
release['audit_integration']={'baseline_commit':inputs['baseline_commit'],'review_date':'2026-10-26',
    'passes':2,'records_per_pass':829,'changed_first_pass':292,'changed_second_pass':339,
    'formatting_only_second_pass':9,'distinct_content_changed':505,'added_phases':59,
    'note':'All records assessed in each pass; this does not mean all claims or endpoints were established.'}
release['audit_history_archive']={'path':'Full_Register_Source_Audits_2026.json.gz',
    'download':'downloads/Full_Register_Source_Audits_2026.json.gz',
    'sha256':hashlib.sha256((ROOT/'migration/audit-inputs.json.gz').read_bytes()).hexdigest(),
    'contents':'Both complete 829-record audit passes, accepted-change catalogues and final reader. Included in the data companion ZIP and available separately.'}
release['source_urls_by_record']={rid:list(dict.fromkeys(re.findall(r'https?://[^\s]+',rr['All recorded source URLs'] or ''))) for rid,rr in byreader.items()}
# Keep the existing normalized entity assignments; reader display strings can
# contain important qualifications that are not additional country entities.
release['country_display_by_record']={rid:rr['Countries / territories'] for rid,rr in byreader.items()}
country_changes={r['record_id'] for cat in catalogs for r in cat for u in r['reader_updates'] if u['field']=='Countries / territories'}
for rid in country_changes:
    release['countries_by_record'][rid]=[re.sub(r'\s*\([^)]*\)','',v).strip() for v in byreader[rid]['Countries / territories'].split(';') if v.strip()]
    release['country_scope_limits_by_record'].pop(rid,None)
    # The current qualification retains the reviewed territorial and traffic
    # scope, including the Kaliningrad railway-only qualification in EU007.

findings=[{f['record_id']:f for f in p['findings']} for p in inputs['passes']]
for rid,rr in byreader.items():
    f=findings[-1][rid]
    current=release['current_review_by_record'].setdefault(rid,{})
    current.update(outcome=rr['Latest verification'],completed='2026-10-26',completed_at_utc='2026-10-26',
        latest_verification_label=rr['Latest verification'],review_scope='Full-record source assessment, second additional whole-register audit',
        ever_full_record_audit=True,latest_cycle='FULL-AUDIT-2',adjudication=f.get('summary'),
        provenance='Six regional reviewers with rotated assignments; coordinator adjudication; retained unresolved and access-limited claims.')
    current['claims']=f.get('claim_checks',[])

# Add each new retrieval as a separately labelled source-access entry, never as
# a fictional independent report. Preserve all prior source history.
index=release['tables']['Source index'];idx={(r['Record ID'],r['Source URL']):r for r in index}
for passno,flist in enumerate(findings,1):
    for rid,f in flist.items():
        for n,s in enumerate(f.get('sources_checked',[]),1):
            u=s.get('url');assert u and u.startswith(('http://','https://'))
            if u not in release['source_urls_by_record'][rid]:release['source_urls_by_record'][rid].append(u)
            key=(rid,u);label=f'AUDIT{passno}-{rid}-{n:03}'
            if key not in idx:
                row={k:None for k in release['native_headers']['Source index']};row.update({'Record ID':rid,'Source URL':u,'Open source':u})
                idx[key]=row;index.append(row)
            row=idx[key]
            fields={'Source labels — all retrievals':label,'Review stages':f'Additional full-register audit {passno}',
                'Publishers / reporting bodies':s.get('publisher'),'Source titles':s.get('title'),
                'Publication date(s)':s.get('publication_date'),'Access statuses — see labelled notes':s.get('access'),
                'Evidence by retrieval label':s.get('supports') or s.get('evidence') or s.get('note'),
                'Access limits by retrieval label':s.get('limitations') or s.get('limitation') or s.get('access_detail'),
                'Reviewers / provenance':f'Full-register audit {passno}; source access and claim qualifications retained'}
            for k,v in fields.items():
                if v is not None:row[k]='\n'.join(x for x in [row.get(k),f'[{label}] {v}'] if x)

# Parent rationales are nonexclusive; the final reader owns attribution. Native
# coding rows are rebuilt only where their explicit category/subcategory changed.
categories=[k for k in release['tables']['Durations'][0] if k in ['Security','Health and biosecurity','Trade and protectionism','Migration','Electoral politics','Interstate disputes and pressure','Power and regime politics','Policy and socioeconomic demands','Administration and service operation','Environment and resource management']]
coding=groups(release['tables']['Rationale coding'],'Record ID');newcoding=[]
for r in release['tables']['Register']:
    rid=r['ID'];text=byreader[rid]['Rationales and attribution'] or '';found=[]
    for line in text.splitlines():
        for cat in categories:
            if line.strip()==cat or line.strip().startswith(cat+' / '):
                sub=line.strip().partition(' / ')[2] or None
                if (cat,sub) not in found:found.append((cat,sub))
    if found:
        oldcats={p['Broad rationale'] for p in coding[rid]}
        r['Current broad rationales']='; '.join(dict.fromkeys(c for c,_ in found))
        for cat,sub in found:
            row=next((copy.deepcopy(x) for x in coding[rid] if x['Broad rationale']==cat and (not sub or x['Subcategory']==sub)),{k:None for k in release['native_headers']['Rationale coding']})
            row.update({'Record ID':rid,'Episode':r['Closure or restriction episode'],'Broad rationale':cat,'Subcategory':sub or row.get('Subcategory'),
                'Coding decision and qualification':text,'Current review status':'Full-register audit 2; attribution and phase qualifications retained'})
            newcoding.append(row)
    else:newcoding.extend(coding[rid])
norm_table('Rationale coding',newcoding)

# Recompute coverage from eligible phase rows, never from stale parent flags.
pg=groups(phases,'Parent record ID');reg={r['ID']:r for r in release['tables']['Register']}
flagcols={'any_dated_evidence':'Any dated phase (1=yes)','operational_complete':'Complete operational (1=yes)',
    'operational_exact_complete':'Exact operational (1=yes)','operational_censored':'Operational censored (1=yes)',
    'same_day':'Same-day operational (1=yes)','formal_policy':'Formal policy (1=yes)','ordered_window':'Ordered window (1=yes)','intermittent_regime':'Intermittent regime (1=yes)'}
for d in release['tables']['Durations']:
    rid=d['Record ID'];ps=[p for p in pg[rid] if p['Analysis included (1=yes)']];r=reg[rid]
    flags={'any_dated_evidence':any(any(p.get(k) for k in ['Start earliest','Start latest','Endpoint earliest','Endpoint latest','Last confirmed (not reopening)']) for p in ps),
        'operational_complete':any(p['Complete operational (1=yes)'] for p in ps),
        'operational_exact_complete':any(p['Exact complete operational (1=yes)'] for p in ps),
        'operational_censored':any(p['Evidence category']=='operational_spell' and p['Interval type']=='confirmed_through' and not p['Contested / held (1=yes)'] for p in ps),
        'same_day':any(p['Evidence category']=='operational_spell' and p['Interval type']=='same_day' for p in ps),
        **{key:any(p['Evidence category']==measure for p in ps) for key,measure in [('formal_policy','formal_policy_period'),('ordered_window','ordered_window'),('intermittent_regime','intermittent_regime')]}}
    d.update({col:int(flags[key]) for key,col in flagcols.items()})
    d.update({'Included (1=yes)':int(r['Analysis inclusion']=='Included'),'Linked phase count':len(pg[rid]),'Review date':'2026-10-26',
        'Current duration interpretation':byreader[rid]['Phase dates and scope'],'Qualification':byreader[rid]['Current uncertainty / qualification'],
        'Current rationale labels':r['Current broad rationales'],'Current review status':'Full-register source assessment completed; phase-specific qualifications retained'})
    # A parent containing several phases has no single combined interval.
    one=ps[0] if len(ps)==1 else {}
    for dest,src in {'Start earliest':'Start earliest','Start latest':'Start latest','Endpoint earliest':'Endpoint earliest',
        'Endpoint latest':'Endpoint latest','Confirmed through (not reopening)':'Last confirmed (not reopening)',
        'Minimum calendar days':'Minimum date difference (days)','Maximum calendar days':'Maximum date difference (days)'}.items():d[dest]=one.get(src)
    d['Period type']=one.get('Interval type') or ('multiple_phases' if ps else 'no_included_phase')
    d['Movement / direction / phase']=byreader[rid]['Traffic, direction and exceptions']
    d['Source URLs']='\n'.join(release['source_urls_by_record'][rid])
    d['Evidence basis']='Current audited Chronology phases; each phase retains its own evidence, scope, endpoint meaning and source URLs.'
    for cat in categories:d[cat]=int(cat in (r['Current broad rationales'] or '').split('; '))
allincluded=[d for d in release['tables']['Durations'] if d['Included (1=yes)']]
for coverage in release['tables']['Timing coverage']:
    dimension=coverage['Dimension'];group=coverage['Group']
    if dimension=='All':ds=allincluded
    elif dimension=='region':ds=[d for d in allincluded if reg[d['Record ID']]['Region']==group]
    elif dimension=='rationale':ds=[d for d in allincluded if d.get(group)]
    else:continue
    coverage['Included records']=len(ds)
    for key,label in [('any_dated_evidence','Any dated evidence'),('operational_complete','Complete operational'),('operational_exact_complete','Exact complete operational'),('operational_censored','Operational censored'),('same_day','Same-day operational'),('formal_policy','Formal policy'),('ordered_window','Ordered window'),('intermittent_regime','Intermittent regime')]:coverage[label]=sum(d[flagcols[key]] for d in ds)
    coverage['No dated evidence']=len(ds)-coverage['Any dated evidence']
    coverage['No complete operational duration']=len(ds)-coverage['Complete operational']
    coverage['Complete operational coverage']=coverage['Complete operational']/len(ds) if ds else 0

# Every phase needs an explicit temporal binding. Native location rows preserve
# their source coordinates; the separate map reconciliation owns map approvals.
bindings=groups(baseline['tables']['Phase locations'],'Phase ID');newbindings=[]
rules={'dated_observations_only':'dated_evidence_only_no_continuity_inference','formal_policy_interval':'legal_policy_layer_only_not_operational_closure','intermittent_regime':'intermittent_envelope_no_continuous_closed_state','held':'held_evidence_do_not_animate_as_confirmed','ordered_window_not_observed_closure':'announced_window_layer_only'}
for p in phases:
    rows=copy.deepcopy(bindings.get(p['Phase ID']) or [{k:None for k in release['native_headers']['Phase locations']}])
    explicit_rule='Temporal display rule' in p and p['Temporal display rule'] is not None
    rule=p.get('Temporal display rule')
    if explicit_rule:rule=rules.get(rule,rule)
    if not explicit_rule:
        rule=next((r['Temporal display rule'] for r in rows if r.get('Temporal display rule')),None)
    if rule is None:
        rule=('held_evidence_do_not_animate_as_confirmed' if p['Contested / held (1=yes)'] else
            'legal_policy_layer_only_not_operational_closure' if p['Evidence category']=='formal_policy_period' else
            'announced_window_layer_only' if p['Evidence category']=='ordered_window' else
            'intermittent_envelope_no_continuous_closed_state' if p['Evidence category']=='intermittent_regime' else
            'scoped_interval_with_endpoint_uncertainty' if p['Complete operational (1=yes)'] else
            'censored_interval_stop_at_last_confirmation_unknown_afterward' if p['Interval type']=='confirmed_through' else
            'dated_evidence_only_no_continuity_inference')
    for b in rows:
        b.update({'Record ID':p['Parent record ID'],'Phase ID':p['Phase ID'],'Current phase scope':p['Movement / crossing / phase scope'],
            'Temporal display rule':rule,'Binding review date':'2026-10-26'})
        if not b.get('Binding decision'):b.update({'Binding decision':'unlocated','Location / marker':'Unlocated','Binding reason / limit':'No new coordinate inferred. See current crossing-scope reconciliation.'})
        newbindings.append(b)
norm_table('Phase locations',newbindings)
release['review_counts'].update(additional_full_register_passes=2,additional_full_register_assessments=1658,distinct_content_changed=505)
release['table_roles']={name:'Preserved historical supporting table; current accepted reader, phases and audit metadata take precedence.' for name in release['tables']}
release['table_roles'].update({'Register':'Current parent inclusion, title and review; Original and Historical fields explicitly retain prior values.',
    'Chronology phases':'Current audited phase chronology and qualifications.','Durations':'Current parent summaries derived from eligible phases; multi-phase parents have no aggregate interval.',
    'Timing coverage':'Current eligible-parent counts by region and nonexclusive rationale; historical snapshot columns remain historical.',
    'Source index':'Cumulative source-access history, including both additional full-register audits.',
    'Rationale coding':'Current nonexclusive parent codes with explicit attribution; phase-specific overrides remain in Chronology phases.',
    'Phase locations':'Current temporal rules; current map geometry decisions are separately bound in source/crossings.'})
release['release_metadata'].update(release_id='2026.10.26-full-audit-2',snapshot_date='2026-10-26',counts=release['counts'])
release['release_metadata']['distinct_recorded_urls']=len({u for us in release['source_urls_by_record'].values() for u in us})
release['release_metadata']['record_url_associations']=sum(map(len,release['source_urls_by_record'].values()))
release['data_state_sha256']=hashlib.sha256(json.dumps({'tables':release['tables'],'audited_reader_by_record':byreader,'audit_integration':release['audit_integration']},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
release['release_metadata']['native_data_state_sha256']=release['data_state_sha256']
validate_native(release)
write(ROOT/'source/current-release.json.gz',release)
write(ROOT/'migration/integration-report.json',{'counts':release['counts'],'phase_patch_records':len(patches),'distinct_content_changed':505,'new_phase_ids':sorted({p['Phase ID'] for p in phases}-{p['Phase ID'] for p in baseline['tables']['Chronology phases']}),'data_state_sha256':release['data_state_sha256']})
print(json.dumps({'counts':release['counts'],'patch_records':len(patches),'sources':release['release_metadata']['distinct_recorded_urls']}))
