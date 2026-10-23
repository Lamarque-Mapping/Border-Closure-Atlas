#!/usr/bin/env python3
"""Reconcile the compiled release independently against its read-only workbook.

Does not import the compiler, fetch sources, mutate the workbook or require HTML.
Missing dates, provenance notes and historical/current separation are checked.
"""
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT/'dist' if (ROOT/'dist').exists() else ROOT/'releases/current_public/web'
EXPECTED_SHA = 'f96ad671372e6fb9c1afd564373d954c717f4bf809b75a757b48f54ee08ca024'
MODEL_SHA = '166953024ad9fb169d6c7c6067455aaf72429fcab467b934db9e4bf79ff5ae3e'

def check(actual, expected, label):
    assert actual == expected, label + ': compiled value differs from current workbook'

def normalized(v):
    if isinstance(v, dt.datetime):
        return v.isoformat() if v.time()!=dt.time() else v.date().isoformat()
    return v.isoformat() if isinstance(v, dt.date) else v

def parts(value, separator=';'):
    return [v.strip() for v in str(value or '').split(separator) if v.strip()]

def grouped(rows, key):
    groups = collections.defaultdict(list)
    for row in rows: groups[row[key]].append(row)
    return groups

x = json.loads((WEB/'data.js').read_text().split('=',1)[1].strip().rstrip(';'))
m = x['meta']; events = x['events']; by_id = {e['id']:e for e in events}
source = ROOT/'source'/m['source_filename']; source_bytes = source.read_bytes()
check(hashlib.sha256(source_bytes).hexdigest(), EXPECTED_SHA, 'Replacement source identity')
check(m['source_sha256'], EXPECTED_SHA, 'Compiled workbook SHA')
check(m['research_method']['source_sha256'], EXPECTED_SHA, 'Method workbook SHA')
check((WEB/'downloads'/m['source_filename']).read_bytes(), source_bytes, 'Workbook download bytes')
w = openpyxl.load_workbook(source, read_only=True, data_only=True)
sheets = {s.title:[[normalized(v) for v in r] for r in s.iter_rows(values_only=True)
                   if any(v is not None for v in r)] for s in w}
w.close()
def table(name, header=0):
    rows=sheets[name]
    return [dict(zip(rows[header],r)) for r in rows[header+1:] if r[0] is not None]

register=table('Register',2); ids=[r['ID'] for r in register]
dimensions={r['ID']:r for r in table('Dimensions')}
durations={r['Record ID']:r for r in table('Durations')}
audits={r['Record ID']:r for r in table('Audit review')}
check(len(ids),701,'Source parent count'); check(len(set(ids)),701,'Unique source IDs')
check([e['id'] for e in events],ids,'Exact compiled IDs and workbook order')
check(len(by_id),701,'Unique compiled IDs')
# Dimensions was not extended for the 48 added parents. They must still import.
new=set(ids)-set(dimensions)
check(len(dimensions),653,'Historical Dimensions rows'); check(len(new),48,'Added parent IDs')
check(collections.Counter(r.split('-')[0] for r in new),{'FU':21,'NP':12,'C7':15},'Added parent groups')
check(collections.Counter(r['Analysis inclusion'] for r in register),
      {'Included':697,'Quarantined':3,'Excluded':1},'Inclusion counts')
check({r['ID'] for r in register if r['Analysis inclusion']=='Quarantined'},
      {'GL18','SA025','R3-SC-004'},'Quarantined IDs')
check({r['ID'] for r in register if r['Analysis inclusion']=='Excluded'},{'SUP-004'},'Excluded ID')
included_ids={r['ID'] for r in register if r['Analysis inclusion']=='Included'}
included=[e for e in events if e['id'] in included_ids]

phases=table('Chronology phases'); phase_groups=grouped(phases,'Parent record ID')
bindings=table('Phase locations'); phase_bindings=grouped(bindings,'Phase ID')
assignment_rows=table('Rationale coding'); assignments=grouped(assignment_rows,'Record ID')
followups=table('Follow-up review'); followup_groups=grouped(followups,'Record ID')
issues=table('Unresolved queue'); issue_groups=grouped(issues,'Record ID')
claims=grouped(table('Claim checks'),'Event ID')
evidence=grouped(table('Evidence'),'Event ID')
chronology_sources=grouped(table('Chronology sources'),'Record ID')
index_rows=table('Source index'); index_groups=grouped(index_rows,'Record ID')
location_groups=collections.defaultdict(list)
for row in table('Locations'):
    for rid in parts(row['Linked records']):
        if rid in by_id: location_groups[rid].append(row)
binding_groups=grouped(bindings,'Record ID')
flags={
 'any_dated_evidence':('Any dated phase (1=yes)','Any dated evidence',695),
 'operational_complete':('Complete operational (1=yes)','Complete operational',252),
 'operational_exact_complete':('Exact operational (1=yes)','Exact complete operational',163),
 'operational_censored':('Operational censored (1=yes)','Operational censored',89),
 'same_day':('Same-day operational (1=yes)','Same-day operational',49),
 'formal_policy':('Formal policy (1=yes)','Formal policy',213),
 'ordered_window':('Ordered window (1=yes)','Ordered window',85),
 'intermittent_regime':('Intermittent regime (1=yes)','Intermittent regime',23)}
record_fields={'title':'Closure or restriction episode','region':'Region',
 'start':'Original start','end':'Original stated endpoint','endpoint_type':'Original endpoint meaning',
 'policy_group':'Related policy / campaign','official_rationale':'Historical recorded justification',
 'context':'Historical recorded context','uncertainty':'Historical uncertainty',
 'evidence_status':'Historical evidence assessment','current_timing':'Current reviewed timing',
 'current_corrections':'Current record corrections','rationale_coding_status':'Rationale coding status',
 'rationale_phase_note':'Rationale phases and overlap'}
correction_fields={'title':'title','start date':'start','end date':'end',
 'start precision':'start_precision','end precision':'end_precision','endpoint type':'endpoint_type',
 'uncertainty':'uncertainty','context':'context','official rationale':'official_rationale',
 'imposing authority':'imposing_authority','border scope':'scope','crossing points':'crossings',
 'exemptions':'exceptions','direction':'direction','last confirmed closed':'last_confirmed_closed',
 'status as of':'status_observation','verification status':'evidence_status','enforcement':'enforcement',
 'start earliest':'start_earliest','start latest':'start_latest','current scope':'scope',
 'rationale coding status':'rationale_coding_status','rationale coding note':'rationale_coding_note',
 'rationale phase note':'rationale_phase_note'}
historical_fields={'start':'Original start','end':'Original stated endpoint','endpoint':'Original endpoint meaning',
 'days':'Original calendar-day calculation','duration_note':'Original duration qualification',
 'evidence_status':'Historical evidence assessment'}
dimension_fields={'start_precision':'Start precision','end_precision':'Endpoint precision',
 'scope':'Geographical scope','crossings':'Crossing points','direction':'Direction',
 'movement':'Affected people or goods','exceptions':'Exceptions','imposing_authority':'Imposing authority',
 'enforcement':'Enforcement evidence','consequences':'Consequences evidence','last_confirmed_closed':'Last confirmed closed',
 'record_type':'Record type','relationship':'Relationship','status_observation':'Status observation'}
phase_fallbacks={'scope':'Movement / crossing / phase scope','direction':'Direction',
 'movement':'Movement','imposing_authority':'Authority'}
phase_fields={'kind':'Interval type','measure_type':'Evidence category','start_earliest':'Start earliest',
 'start_latest':'Start latest','last_confirmed':'Last confirmed (not reopening)',
 'minimum_days':'Minimum date difference (days)','maximum_days':'Maximum date difference (days)',
 'display':'Current duration interpretation','scope':'Movement / crossing / phase scope','movement':'Movement',
 'direction':'Direction','authority':'Authority','continuity_status':'Continuity assessment',
 'endpoint_status':'Endpoint status','basis':'Evidence basis','qualification':'Qualification',
 'review_type':'Current review provenance','calculation_rule':'Calculation rule',
 'reported_duration':'Reported duration detail','reported_schedule':'Reported schedule / clock detail',
 'endpoint_inclusion':'Endpoint inclusion recorded','observed_reopening':'Endpoint is observed reopening'}
known={f['properties']['location_id'] for key in ['locations','context_locations'] for f in x[key]['features']}
numeric_checks=0
for r in register:
    rid=r['ID']; e=by_id[rid]; dur=durations[rid]; audit=audits[rid]
    check(e['source_register'],r,rid+' complete Register row')
    check(e['source_duration'],dur,rid+' complete Durations row')
    if rid in dimensions: check(e['source_dimensions'],dimensions[rid],rid+' Dimensions row')
    else: assert all(v is None for v in e['source_dimensions'].values()),rid+' invented Dimensions fields'
    check(e['inclusion_status'],r['Analysis inclusion'],rid+' inclusion')
    for field in ['quarantined','excluded_from_map']: check(e[field],rid not in included_ids,rid+' '+field)
    assert set(e['location_ids'])<=known,rid+' dangling reference geometry'
    if rid not in included_ids: assert not e['location_ids'] and not e['location_links'],rid+' excluded geometry'
    expected={f:r[c] for f,c in record_fields.items()}
    dim=dimensions.get(rid,{})
    expected.update({f:dim.get(c) for f,c in dimension_fields.items()})
    for field,column in phase_fallbacks.items():
        if not expected[field]:
            expected[field]='; '.join(dict.fromkeys(str(p[column]) for p in phase_groups[rid] if p.get(column))) or None
    if not expected['crossings']:
        expected['crossings']='; '.join(dict.fromkeys(row['Name / original scope text'] for row in location_groups[rid])) or None
    check(e['countries'],parts(dim.get('Countries or territories')) or
          sorted({c for row in location_groups[rid] for c in parts(row['Countries'])}),rid+' countries from current source only')
    for line in str(r['Current record corrections'] or '').splitlines():
        key,sep,value=line.partition(':')
        if sep and key in correction_fields: expected[correction_fields[key]]=value.strip() or None
    for f,v in expected.items(): check(e.get(f),v,rid+' current '+f)
    for f,c in historical_fields.items(): check(e['historical'][f],r[c],rid+' historical '+f)
    check(e['historical']['claim_checks'],claims[rid],rid+' historical claims')
    for f,rows in [('rationale_assignments',assignments[rid]),('followup_reviews',followup_groups[rid]),
                   ('unresolved_issues',issue_groups[rid]),('workbook_locations',location_groups[rid]),
                   ('phase_locations',binding_groups[rid])]: check(e[f],rows,rid+' '+f)
    codes={a['Broad rationale'] for a in assignments[rid] if a['Broad rationale']!='Uncoded'}
    check(set(e['rationales']),codes,rid+' rationale assignments')
    check(set(parts(r['Current broad rationales'])) & set(m['rationale_categories']),codes,rid+' Register rationale join')
    for f,(col,_,_) in flags.items(): check(e['timing_coverage'][f],bool(dur[col]),rid+' '+f)
    check(e['current_review']['outcome'],r['Current audit outcome'],rid+' current outcome')
    check(e['current_review']['claims'],[],rid+' initial claims must not be current')
    check(e['current_review']['open_evidence_needs'],audit['Current open evidence needs'],rid+' current needs')
    for f in ['occurrence','start','endpoint','scope','continuity','rationale']:
        claim=next(c for c in e['initial_review']['claims'] if c['field']==f)
        original=audit['Initial '+f+' finding'] or ''; prefix,sep,note=original.partition(':')
        check(claim['assessment'],prefix if sep else 'unresolved',rid+' initial '+f+' assessment')
        check(claim['note'],note.strip() if sep else original,rid+' initial '+f+' note')
    check(e['initial_review']['input_claim_sha256'],audit['Initial claim SHA-256'],rid+' initial review input')
    for field,column in [('completed','Initial review completed (UTC)'),('adjudication','Initial root adjudication'),
                         ('blind_outcome','Initial blind reconstruction outcome'),
                         ('source_check_applicability','Initial source-check applicability')]:
        check(e['initial_review'][field],audit[column],rid+' initial review '+field)
    for field,column in [('status','Current review status'),('display','Current duration interpretation'),
                         ('priority','Queue priority'),('next_step','Next evidence step'),
                         ('review_date','Review date'),('method','Review method and limits')]:
        check(e['duration_review'][field],dur[column],rid+' current duration '+field)
    check([p['period_id'] for p in e['duration_periods']],[p['Phase ID'] for p in phase_groups[rid]],rid+' phase IDs/order')
    for p,raw in zip(e['duration_periods'],phase_groups[rid]):
        pid=raw['Phase ID']; check(p['source_phase'],raw,pid+' complete raw phase')
        check(p['parent_event_id'],rid,pid+' parent')
        for f,col in phase_fields.items(): check(p[f],raw[col],pid+' '+f)
        for f,col in [('end_earliest','Endpoint earliest'),('end_latest','Endpoint latest')]:
            check(p[f],raw[col] or raw['Last confirmed (not reopening)'],pid+' endpoint display fallback')
        check(p['end_is_reopening'],raw['Endpoint is observed reopening']=='Yes',pid+' reopening truth')
        check(p['end_inclusive'],raw['Endpoint inclusion recorded']=='Inclusive',pid+' inclusion truth')
        for f,col in [('contested','Contested / held (1=yes)'),('complete_operational','Complete operational (1=yes)'),
                      ('exact_complete_operational','Exact complete operational (1=yes)')]: check(p[f],bool(raw[col]),pid+' '+f)
        check(p['source_ids'],parts(raw['Source IDs']),pid+' source IDs')
        check(p['source_urls'],parts(raw['Source URLs'],'\n'),pid+' source URLs')
        check(p['location_bindings'],phase_bindings[pid],pid+' location decisions')
        check({p['temporal_display_rule']},{b['Temporal display rule'] for b in phase_bindings[pid]},pid+' temporal rule')
        dates=sorted({raw[k] for k in ['Start earliest','Start latest','Endpoint earliest','Endpoint latest',
                                      'Last confirmed (not reopening)'] if raw[k]})
        check(p['evidence_dates'],dates,pid+' no invented evidence dates')
        if p['contested'] or p['kind']=='same_day' or p['measure_type']=='intermittent_regime':
            assert p['minimum_days'] is None and p['maximum_days'] is None,pid+' inappropriate numeric duration'
        if p['contested']: assert not p['complete_operational'] and not p['exact_complete_operational'],pid+' held promoted'
        bounds=[p[k] for k in ['start_earliest','start_latest','end_earliest','end_latest']]
        if all(bounds) and p['calculation_rule']=='calendar_bounds':
            a,b,c,d=map(dt.date.fromisoformat,bounds)
            assert a<=b and c<=d and a<=d,pid+' reversed bounds'
            if p['minimum_days'] is not None:
                check(p['minimum_days'],max(0,(c-b).days),pid+' minimum date difference'); numeric_checks+=1
            if p['maximum_days'] is not None: check(p['maximum_days'],(d-a).days,pid+' maximum date difference')
        if p['endpoint_status']=='last_confirmed': assert p['maximum_days'] is None,pid+' invented maximum duration'
    urls={s['URL'] for s in evidence[rid]+chronology_sources[rid] if s['URL']}
    urls.update(s['Source URL'] for s in index_groups[rid] if s['Source URL'])
    urls.update(u for p in phase_groups[rid] for u in parts(p['Source URLs'],'\n'))
    sources={s['url']:s for s in e['sources']}
    check(set(sources),urls,rid+' full current source URLs'); check(set(e['source_urls']),urls,rid+' URL index')
    check(len(e['sources']),len(urls),rid+' URL deduplication')
    for row in index_groups[rid]:
        s=sources[row['Source URL']]; check(s['source_index'],row,rid+' complete Source index row')
        assert any(h['id']==row['Source labels — all retrievals'] and h['stage']==row['Review stages']
            and h.get('inspected')==row['Evidence by retrieval label'] and h.get('limitation')==row['Access limits by retrieval label']
            and h.get('claims')==row['Claims by retrieval label'] and h.get('statuses')==row['Access statuses — see labelled notes']
            and h.get('provenance')==row['Reviewers / provenance'] for h in s['access_history']),rid+' truncated retrieval notes'

summary=m['atlas_summary']['chronology_coverage']; coverage=table('Timing coverage')[0]
for flag,(column,coverage_column,expected) in flags.items():
    check(sum(bool(durations[rid][column]) for rid in included_ids),expected,flag+' source count')
    check(coverage[coverage_column],expected,flag+' coverage table')
    check(sum(e['timing_coverage'][flag] for e in included),expected,flag+' compiled count')
    check(summary[flag],expected,flag+' metadata count')
check({rid for rid in included_ids if not durations[rid]['Any dated phase (1=yes)']},{'H06','R2-EA-002'},'Undated records')
check(len(phases),827,'Source phase count'); check(len({p['Phase ID'] for p in phases}),827,'Unique phase IDs')
check(sum(len(e['duration_periods']) for e in events),827,'Compiled phase count')
check(sum(len(e['duration_periods']) for e in included),825,'Included phases')
check(sum(p['contested'] for e in included for p in e['duration_periods']),19,'Included held phases')
rationale_counts={'Security':292,'Health and biosecurity':253,'Trade and protectionism':69,'Migration':45,
 'Electoral politics':80,'Interstate disputes and pressure':66,'Power and regime politics':36,
 'Policy and socioeconomic demands':49,'Administration and service operation':3,'Environment and resource management':2}
check(set(m['rationale_categories']),set(rationale_counts),'Ten current rationale categories')
for category,expected in rationale_counts.items():
    check(len({r['Record ID'] for r in assignment_rows if r['Record ID'] in included_ids and r['Broad rationale']==category}),expected,category+' source count')
    check(sum(category in e['rationales'] for e in included),expected,category+' compiled count')
check(m['rationale_counts'],rationale_counts,'Rationale metadata')
check(sum(not e['rationales'] for e in included),20,'No assigned category count')
check(len(followups),368,'Follow-up rows'); check(m['followup_review_count'],368,'Follow-up metadata')
check(m['followup_parent_count'],len({r['Record ID'] for r in followups if r['Record ID'] in by_id}),'Follow-up parent metadata')
check(len(issues),371,'Open evidence rows'); check(len({r['Record ID'] for r in issues}),218,'Open evidence parents')
check(m['review_queue_items'],371,'Open evidence metadata'); check(m['open_issue_parent_count'],218,'Open parent metadata')
check(len(index_rows),4376,'Grouped record–URL entries'); check(m['source_index_rows'],4376,'Source metadata')
check(len({(r['Record ID'],r['Source URL']) for r in index_rows}),4376,'Unique record–URL entries')
check(len(bindings),836,'Phase binding rows')
binding_counts={'approved_approximate':16,'unlocated':811,'rejected_wrong_crossing':5,'unverified_phase_applicability':4}
check(dict(collections.Counter(r['Binding decision'] for r in bindings)),binding_counts,'Source binding counts')
check(m['phase_binding_counts'],binding_counts,'Binding metadata')
for field,sheet in [('locations','Locations'),('phase_locations','Phase locations')]:
    check(x['workbook_geography'][field],table(sheet),'Complete '+sheet+' table')
for field,sheet in [('followup_review','Follow-up review'),('audit_changes','Audit changes'),
                    ('relationships','Relationships'),('country_year_coverage','Country-year coverage')]:
    check(x['workbook_review'][field],table(sheet),'Complete '+sheet+' table')
codebook={r[0]:r[1] for r in sheets['Codebook'][1:]}
check(m['codebook'],codebook,'Replacement Codebook'); check(m['release_summary'],table('Release summary'),'Replacement Release summary')
check(m['source_model_sha256'],codebook['Corrected model identity'],'Workbook model identity')
check(m['source_model_sha256'],MODEL_SHA,'Correction model SHA')
check(m['research_method']['verification_statement'],codebook['Correction release 23 October 2026'],'Current review provenance')
check(m['snapshot_date'],'2026-10-23','Snapshot date')
check(m['window_start'],'2016-10-21','Study start'); check(m['window_end'],'2026-10-21','Study end')
print(f'Workbook reconciliation passed: identical source/download; 701 ordered IDs including 48 additions; '
      f'697 included; 827 phases; {numeric_checks} numeric minima; endpoint/missing-date safeguards; '
      '10 rationale groups; initial/current separation; 368 follow-ups; 371 issues; '
      '4,376 source histories; 836 location decisions; current Codebook/model identity.')
