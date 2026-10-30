#!/usr/bin/env python3
"""Compile current native tables, preserving historical claims separately.

Usage: python scripts/import-workbook.py [--release PATH] [--output PATH]
Explicit --workbook retains legacy extraction for historical comparisons.
The two-tab public reader is validated separately. Geometry is reference context,
not a reconstruction of each timed phase. No external research is performed here.
"""
import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from release_common import DATA_PATH, MANIFEST_PATH, load_json, native_sheets, read_manifest, sha256
from record_descriptions import attach_descriptions

ROOT = Path(__file__).resolve().parents[1]
CATEGORY_ORDER = ['Security', 'Health and biosecurity', 'Trade and protectionism', 'Migration',
                  'Electoral politics', 'Interstate disputes and pressure', 'Power and regime politics',
                  'Policy and socioeconomic demands', 'Administration and service operation',
                  'Environment and resource management']
FLAGS = {'any_dated_evidence': 'Any dated phase (1=yes)',
         'operational_complete': 'Complete operational (1=yes)',
         'operational_exact_complete': 'Exact operational (1=yes)',
         'operational_censored': 'Operational censored (1=yes)',
         'same_day': 'Same-day operational (1=yes)', 'formal_policy': 'Formal policy (1=yes)',
         'ordered_window': 'Ordered window (1=yes)', 'intermittent_regime': 'Intermittent regime (1=yes)'}

def split(value, separator=';'):
    return [s.strip() for s in str(value or '').split(separator) if s.strip()]

def date(value):
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()[:10]
    return value[:10] if isinstance(value, str) and re.match(r'^\d{4}-\d{2}-\d{2}T', value) else value

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')

def read_workbook(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    convert = lambda c: c.isoformat() if isinstance(c,dt.datetime) and c.time()!=dt.time() else date(c)
    sheets = {s.title: [[convert(c) for c in row] for row in s.iter_rows(values_only=True)
                        if any(v is not None for v in row)] for s in wb}
    wb.close()
    return sheets

def table(sheets, name, header=0):
    rows = sheets[name]
    return [dict(zip(rows[header], row)) for row in rows[header+1:] if row[0] is not None]

def compile_workbook(sheets, reference, workbook_name, workbook_hash, release=None):
    registers = table(sheets, 'Register', 2)
    categories = [c for c in CATEGORY_ORDER if c in sheets['Durations'][0]]
    assert set(categories) == {r['Broad rationale'] for r in table(sheets, 'Rationale coding') if r['Broad rationale'] != 'Uncoded'}, 'Unrecognised rationale category'
    codebook = {r[0]: r[1] for r in sheets['Codebook'][1:]}
    snapshot = max(str(r['Review date'])[:10] for r in table(sheets, 'Durations') if r['Review date'])
    ids = {r['ID'] for r in registers}
    assert len(ids) == len(registers), 'Duplicate parent IDs'
    maps = {e['id']: e for e in reference['events']}
    dimensions = {r['ID']: r for r in table(sheets, 'Dimensions')}
    durations = {r['Record ID']: r for r in table(sheets, 'Durations')}
    audits = {r['Record ID']: r for r in table(sheets, 'Audit review')}
    grouped = {}
    for name, key in [('Chronology phases', 'Parent record ID'), ('Rationale coding', 'Record ID'),
                      ('Evidence', 'Event ID'), ('Claim checks', 'Event ID'),
                      ('Source index', 'Record ID'), ('Unresolved queue', 'Record ID'),
                      ('Follow-up review', 'Record ID'), ('Phase locations', 'Record ID'),
                      ('Chronology sources', 'Record ID')]:
        group = collections.defaultdict(list)
        for row in table(sheets, name):
            # Follow-up also contains coverage findings that are not parent records.
            if name != 'Follow-up review': assert row[key] in ids, (name, row[key])
            group[row[key]].append(row)
        grouped[name] = group
    location_rows = collections.defaultdict(list)
    for row in table(sheets, 'Locations'):
        for rid in split(row['Linked records']):
            if rid in ids: location_rows[rid].append(row)
    phase_bindings = collections.defaultdict(list)
    for row in table(sheets, 'Phase locations'): phase_bindings[row['Phase ID']].append(row)
    region_continents = {'Europe':['Europe'],'Americas':['Unassigned'],'East and Southeast Asia and Oceania':['Asia','Oceania'],
        'South Asia':['Asia'],'Central Asia and Caucasus':['Asia'],'Middle East':['Asia'],
        'Great Lakes':['Africa'],'Horn of Africa':['Africa'],'Horn and eastern Africa':['Africa'],
        'North Africa':['Africa'],'West Africa and Sahel':['Africa'],'Southern and Central Africa':['Africa']}
    country_continents = {}
    for feature in reference['countries']['features']:
        props=feature['properties']
        for key in ['NAME','ADMIN','NAME_LONG']:
            if props.get(key):country_continents[props[key]]=props.get('CONTINENT')
    for ge in reference['events']:
        if len(ge.get('continents',[]))==1:
            for country in ge.get('countries',[]):country_continents.setdefault(country,ge['continents'][0])
    features={f['properties']['location_id']:f for f in reference['locations']['features']+reference['context_locations']['features']}
    contexts=collections.defaultdict(list)
    for link in reference['crossing_contexts']:contexts[link['location_id']].append(link['context_location_id'])
    def country_key(value):
        value=re.sub(r'\s*\([^)]*\)', '', value or '').strip().casefold()
        return {'dem. rep. congo':'democratic republic of the congo','united states of america':'united states',
                'ivory coast':'côte d’ivoire','cote d\'ivoire':'côte d’ivoire','côte d\'ivoire':'côte d’ivoire',
                'turkey':'türkiye','republic of korea':'south korea','swaziland':'eswatini'}.get(value,value)
    country_names_by_code={f['properties']['ADM0_A3']:f['properties']['ADMIN'] for f in reference['countries']['features']}
    for feature in features.values():
        props=feature['properties']
        if not props.get('countries'):
            props['countries']=[country_names_by_code[c] for c in props.get('country_codes',[]) if c in country_names_by_code]
    events = []
    geography_changes = []
    for r in registers:
        rid = r['ID']; dim = collections.defaultdict(lambda:None,dimensions.get(rid, {})); dur = durations[rid]; audit = audits[rid]
        excluded = r['Analysis inclusion'] != 'Included'
        assert bool(dur['Included (1=yes)']) == (not excluded), rid
        geo = copy.deepcopy(maps.get(rid, {}))
        e = {k: v for k, v in geo.items() if k in ['location_ids','continents','mapping_precision']}
        workbook_locations=location_rows[rid]
        countries=(release['countries_by_record'][rid] if release is not None else
            split(dim['Countries or territories']) or sorted({c for row in workbook_locations for c in split(row['Countries'])}))
        phases=grouped['Chronology phases'][rid]
        def phase_values(column):return '; '.join(dict.fromkeys(str(p[column]) for p in phases if p.get(column))) or None
        e.update(id=rid, title=r['Closure or restriction episode'], region=r['Region'],
                 countries=countries, start=date(r['Original start']),
                 end=date(r['Original stated endpoint']), start_precision=dim['Start precision'],
                 end_precision=dim['Endpoint precision'], endpoint_type=r['Original endpoint meaning'],
                 scope=dim['Geographical scope'] or phase_values('Movement / crossing / phase scope'),
                 crossings=dim['Crossing points'] or '; '.join(dict.fromkeys(row['Name / original scope text'] for row in workbook_locations)) or None,
                 direction=dim['Direction'] or phase_values('Direction'), movement=dim['Affected people or goods'] or phase_values('Movement'),
                 exceptions=dim['Exceptions'], imposing_authority=dim['Imposing authority'] or phase_values('Authority'),
                 enforcement=dim['Enforcement evidence'], consequences=dim['Consequences evidence'],
                 last_confirmed_closed=date(dim['Last confirmed closed']), record_type=dim['Record type'],
                 relationship=dim['Relationship'], status_observation=dim['Status observation'],
                 policy_group=r['Related policy / campaign'], official_rationale=r['Historical recorded justification'],
                 context=r['Historical recorded context'], uncertainty=r['Historical uncertainty'],
                 evidence_status=r['Historical evidence assessment'],
                 historical={'start': date(r['Original start']), 'end': date(r['Original stated endpoint']),
                             'endpoint': r['Original endpoint meaning'], 'days': r['Original calendar-day calculation'],
                             'duration_note': r['Original duration qualification'],
                             'evidence_status': r['Historical evidence assessment'],
                             'claim_checks': grouped['Claim checks'][rid]},
                 inclusion_status=r['Analysis inclusion'], quarantined=excluded, excluded_from_map=excluded,
                 quarantine_reason=audit['Current adjudicated outcome'] if excluded else None,
                 current_timing=r['Current reviewed timing'], current_corrections=r['Current record corrections'],
                 rationale_coding_status=r['Rationale coding status'],
                 rationale_phase_note=r['Rationale phases and overlap'],
                 rationale_assignments=grouped['Rationale coding'][rid],
                 unresolved_issues=grouped['Unresolved queue'][rid],
                 followup_reviews=grouped['Follow-up review'][rid],
                 workbook_locations=workbook_locations, phase_locations=grouped['Phase locations'][rid],
                 source_register=r, source_dimensions=dict(dim), source_duration=dur)
        # The workbook deliberately preserves old parent dates. Explicit current
        # corrections override them; narrower phase bounds remain separate.
        correction_fields = {'title': 'title', 'start date': 'start', 'end date': 'end',
            'start precision': 'start_precision', 'end precision': 'end_precision',
            'endpoint type': 'endpoint_type', 'uncertainty': 'uncertainty', 'context': 'context',
            'official rationale': 'official_rationale', 'imposing authority': 'imposing_authority',
            'border scope': 'scope', 'crossing points': 'crossings', 'exemptions': 'exceptions',
            'direction': 'direction', 'last confirmed closed': 'last_confirmed_closed',
            'status as of': 'status_observation', 'verification status': 'evidence_status',
            'enforcement': 'enforcement', 'start earliest': 'start_earliest', 'start latest': 'start_latest',
            'current scope':'scope','rationale coding status':'rationale_coding_status','rationale coding note':'rationale_coding_note',
            'rationale phase note':'rationale_phase_note'}
        for line in (r['Current record corrections'] or '').splitlines():
            key, sep, val = line.partition(':')
            if sep and key in correction_fields:
                e[correction_fields[key]] = val.strip() or None
        e['rationales'] = [c for c in split(r['Current broad rationales']) if c in categories]
        assignments = e['rationale_assignments']
        e['rationale_subcategories'] = {c: sorted({a['Subcategory'] for a in assignments
            if a['Broad rationale'] == c and a['Subcategory']}) for c in e['rationales']}
        assert set(e['rationales']) == {a['Broad rationale'] for a in assignments if a['Broad rationale'] in categories}, rid
        claims = []
        for field, col in [('occurrence','Occurrence finding'),('start','Start finding'),
                           ('endpoint','Endpoint finding'),('scope','Scope finding'),
                           ('continuity','Continuity finding'),('rationale','Rationale finding')]:
            value = audit['Initial '+col.lower()] or ''
            assessment, sep, note = value.partition(':')
            claims.append({'field': field, 'assessment': assessment if sep else 'unresolved',
                           'note': note.strip() if sep else value})
        e['initial_review'] = {'claims':claims, 'completed':audit['Initial review completed (UTC)'],
            'input_claim_sha256':audit['Initial claim SHA-256'], 'adjudication':audit['Initial root adjudication'],
            'blind_outcome':audit['Initial blind reconstruction outcome'],
            'source_check_applicability':audit['Initial source-check applicability']}
        e['current_review'] = {'outcome': r['Current audit outcome'], 'claims': [],
            'completed':date(dur['Review date']), 'open_evidence_needs':audit['Current open evidence needs'],
            'adjudication':None, 'followup_count':len(e['followup_reviews']),
            'provenance':'Current Register, Chronology phases and Follow-up review; initial six-field findings are historical.'}
        periods = []
        for p in grouped['Chronology phases'][rid]:
            last = date(p['Last confirmed (not reopening)'])
            kind = p['Interval type']; measure = p['Evidence category']; held = bool(p['Contested / held (1=yes)'])
            q = {'period_id': p['Phase ID'], 'parent_event_id': rid, 'kind': kind, 'measure_type': measure,
                'start_earliest': date(p['Start earliest']), 'start_latest': date(p['Start latest']),
                'end_earliest': date(p['Endpoint earliest']) or last,
                'end_latest': date(p['Endpoint latest']) or last, 'last_confirmed': last,
                'minimum_days': p['Minimum date difference (days)'], 'maximum_days': p['Maximum date difference (days)'],
                'display': p['Current duration interpretation'], 'scope': p['Movement / crossing / phase scope'],
                'movement': p['Movement'], 'direction': p['Direction'], 'authority': p['Authority'],
                'continuity_status': p['Continuity assessment'], 'endpoint_status': p['Endpoint status'],
                'basis': p['Evidence basis'], 'qualification': p['Qualification'],
                'source_ids': split(p['Source IDs']), 'source_urls': split(p['Source URLs'], '\n'),
                'review_type': p['Current review provenance'], 'review_date': date(dur['Review date']),
                'contested': held, 'calculation_rule': p['Calculation rule'],
                'reported_duration': p['Reported duration detail'], 'reported_schedule':p['Reported schedule / clock detail'],
                'endpoint_inclusion':p['Endpoint inclusion recorded'], 'end_inclusive':p['Endpoint inclusion recorded']=='Inclusive',
                'observed_reopening':p['Endpoint is observed reopening'],
                'policy_only': measure == 'formal_policy_period',
                'end_is_reopening': p['Endpoint is observed reopening']=='Yes',
                'complete_operational': bool(p['Complete operational (1=yes)']),
                'exact_complete_operational': bool(p['Exact complete operational (1=yes)']),
                'map_scope_note': 'Coloured border lines locate the record only; they are not approved phase geometry or a closure footprint.',
                'source_phase':p, 'location_bindings':phase_bindings[p['Phase ID']],
                'evidence_dates':sorted({date(p[k]) for k in ['Start earliest','Start latest','Endpoint earliest','Endpoint latest','Last confirmed (not reopening)'] if p[k]})}
            q['analysis_included']=p.get('Analysis included (1=yes)',p['Parent included (1=yes)'])!=0
            if p.get('Over 24 hours basis') or p.get('Strictly over 24 hours') is not None:
                q['strictly_over_24_hours']=p.get('Strictly over 24 hours')
                q['over_24_hours_basis']=p.get('Over 24 hours basis')
            if isinstance(p.get('Phase broad rationales'),list):q['rationales']=p['Phase broad rationales']
            if p.get('Later access observations'):q['later_access_observations']=p['Later access observations']
            rules={b['Temporal display rule'] for b in q['location_bindings']}
            assert len(rules)==1,(rid,p['Phase ID'],rules)
            q['temporal_display_rule']=rules.pop()
            periods.append(q)
        e['duration_periods'] = periods
        e['timing_coverage'] = {key: bool(dur[col]) for key, col in FLAGS.items()}
        e['duration_review'] = {'status': dur['Current review status'], 'display': dur['Current duration interpretation'],
            'priority': dur['Queue priority'], 'next_step': dur['Next evidence step'], 'review_date': date(dur['Review date']),
            'period_count': len(periods), 'measure_types': sorted({p['measure_type'] for p in periods}),
            'method': dur['Review method and limits']}
        # Keep evidence provenance per URL. Historical and current access checks
        # remain distinct; a later failed retrieval never erases earlier access.
        sources = {}
        for s in grouped['Evidence'][rid]:
            url = s['URL']
            if not url: continue
            sources[url] = {'source_id': s['Source ID'], 'publisher': s['Publisher'],
                'origin': s['Original reporting source'], 'title': s['Title'], 'publication_date': date(s['Publication date']),
                'url': url, 'source_type': s['Source type'], 'content_access': s['Access level'],
                'supports': split(s['Supports fields']), 'evidence_note': s['Evidence note'], 'access_history': []}
        for s in grouped['Chronology sources'][rid]:
            url=s['URL']
            if not url: continue
            item=sources.setdefault(url,{'source_id':s['Source ID'],'publisher':s['Publisher'],
                'origin':s['Reporting origin'],'title':s['Title'],'publication_date':date(s['Publication date']),
                'url':url,'source_type':'Chronology evidence','content_access':s['Access achieved'],
                'supports':split(s['Claims addressed']),'access_history':[]})
            item['access_history'].append({'id':s['Source ID'],'stage':s['Review stage'],
                'access':s['Access achieved'],'inspected':s['Evidence inspected'],'limitation':s['Access detail']})
        for s in grouped['Source index'][rid]:
            url = s['Source URL']
            if not url: continue
            item = sources.setdefault(url, {'source_id': s['Source labels — all retrievals'], 'publisher': s['Publishers / reporting bodies'],
                'origin': s['Reporting origins (not independent mirrors)'], 'title': s['Source titles'],
                'publication_date': s['Publication date(s)'], 'url': url, 'source_type': 'Source / access record',
                'content_access': 'See labelled retrieval history', 'supports': [], 'access_history': []})
            item['source_index']=s
            item['access_history'].append({'id':s['Source labels — all retrievals'],'stage':s['Review stages'],
                'access':'Separate outcomes by retrieval label', 'inspected':s['Evidence by retrieval label'],
                'limitation':s['Access limits by retrieval label'], 'claims':s['Claims by retrieval label'],
                'statuses':s['Access statuses — see labelled notes'],'provenance':s['Reviewers / provenance']})
        for p in periods:
            for url in p['source_urls']:
                sources.setdefault(url, {'url': url, 'title': 'Chronology evidence', 'supports': [], 'access_history': []})
        e['sources'] = list(sources.values()); e['source_urls'] = list(sources)
        # Phase starts need not be the first start of the parent episode. Keep
        # every supported month with its evidence category, without filling the
        # deliberately historical Original start field or using held dates.
        e['phase_onsets'] = []
        for p in periods:
            a,b=p['start_earliest'],p['start_latest']
            if excluded or not p['analysis_included'] or p['contested'] or not a or not b: continue
            try: first,last=dt.date.fromisoformat(a),dt.date.fromisoformat(b)
            except (ValueError,TypeError): continue
            if first<=last and a[:7]==b[:7]:
                e['phase_onsets'].append({'phase_id':p['period_id'],'month':a[:7],
                    'measure_type':p['measure_type']})
        e['onset_months'] = sorted({p['month'] for p in e['phase_onsets']})
        e['onset_month'] = next(iter(e['onset_months']),None)
        e['onset_status'] = 'supported_phase_starts' if e['phase_onsets'] else 'current_start_unresolved'
        e['onset_basis'] = ('Current non-held phase start bounds fall within the same calendar month. '
            'Operational, legal-policy, announced-window and intermittent starts retain their evidence categories; '
            'a later scoped phase is not a new independent parent episode.')
        e.update(interval_eligible=False, interval_start=None, interval_end=None,
                 interval_status='use_current_scoped_phases', interval_exclusion_reasons=[],
                 interval_basis='Current chronology phases supersede historical single-interval calculations.',
                 source_interval_days=r['Original calendar-day calculation'], source_continuity_flag=None)
        if not geo or release is not None:
            continents_by_key={country_key(k):v for k,v in country_continents.items()}
            continents=sorted({continents_by_key[country_key(c)] for c in countries if continents_by_key.get(country_key(c))})
            e.update(location_ids=[], location_links=[], continents=continents or region_continents.get(e['region'],['Unassigned']), mapping_precision='unlocated',
                     geography_note='This new record requires geographical review before mapping.', spatial_review_current=False)
        # Rebuild record-reference associations from the replacement's countries.
        # Old crossing bindings are never carried into current phase geography.
        names={country_key(c) for c in e['countries']}
        old_ids=set(geo.get('location_ids',[]))
        old_ids.update(c for lid in list(old_ids) for c in contexts[lid])
        line_ids=[]
        for lid,f in features.items():
            if f['geometry']['type'] not in ['LineString','MultiLineString','Polygon','MultiPolygon']:continue
            props=f['properties'];fc={country_key(c) for c in props.get('countries',[])}
            if not fc or not fc.issubset(names):continue
            if lid in old_ids or (len(names)==2 and fc==names and len(fc)==2):line_ids.append(lid)
        e['location_ids']=sorted(line_ids) if not excluded else []
        e['mapping_precision']=('country_context' if line_ids and all(features[lid]['geometry']['type'] in ['Polygon','MultiPolygon'] for lid in line_ids)
            else 'frontier_context' if line_ids else 'unlocated')
        e['spatial_review_current']=False
        if any(e.get(k) != geo.get(k) for k in ['scope', 'crossings', 'countries']):
            geography_changes.append({'id': rid, 'before': {k: geo.get(k) for k in ['scope','crossings','countries']},
                                      'after': {k: e.get(k) for k in ['scope','crossings','countries']},
                                      'location_ids': e.get('location_ids', [])})
        # References identify the parent record geography only. No review of new
        # scope is implied by carrying an existing reference through this import.
        role=e.get('mapping_precision')
        e['geography_note'] = ('Location not established.' if role=='unlocated' else 'Crossing reference.' if role=='crossing_reference' else
            'Country outline for geographical context.' if role=='country_context' else
            'Generalized border reference.') + ' Current record scope: ' + str(e['scope'] or 'Not established') + '. Coloured lines locate matching records; they are not approved phase geometry or the extent of a closure. Phase location approvals are recorded separately in the current workbook.'
        e['location_links'] = [{'event_id':rid,'location_id':lid,'coverage_role':role,
            'geography_note':e['geography_note'],'reference_only':True} for lid in e.get('location_ids',[])]
        if excluded:
            e['location_ids'] = []; e['location_links'] = []; e['mapping_precision'] = 'excluded'
        e['geography_reference_hash'] = geo.get('event_hash')
        e['event_hash'] = hashlib.sha256(json.dumps({'register': r, 'dimensions': dim, 'phases': periods, 'review': audit}, sort_keys=True).encode()).hexdigest()
        if release is not None:
            reader=release.get('audited_reader_by_record',{}).get(rid)
            if reader:
                e['audited_reader']=copy.deepcopy(reader)
                e['audit_current']=True
                e.update(title=reader['Closure or restriction'],scope=reader['Crossing and scope'],
                    movement=reader['Traffic, direction and exceptions'],official_rationale=reader['Rationales and attribution'],
                    uncertainty=reader['Current uncertainty / qualification'],current_timing=reader['Phase dates and scope'],
                    crossings=reader['Crossing and scope'],
                    direction='See the combined traffic, direction and exceptions description.',
                    exceptions='See the combined traffic, direction and exceptions description.')
                # Native source fields retain historical values and are downloadable.
                # Current prose is the accepted reader, not a stale earlier summary.
                for url in release['source_urls_by_record'][rid]:
                    if url not in e['source_urls']:
                        e['source_urls'].append(url);e['sources'].append({'url':url,'title':'Recorded audit evidence','access_history':[],'supports':[]})
            e['release_review'] = copy.deepcopy(release.get('current_review_by_record',{}).get(rid,{}))
            e['country_display'] = release.get('country_display_by_record',{}).get(rid)
            current=e['release_review']
            for key in ['outcome','completed','adjudication','provenance','review_scope','latest_cycle',
                        'completed_at_utc','ever_full_record_audit','latest_verification_label']:
                if key in current:e['current_review'][key]=copy.deepcopy(current[key])
            if 'claims' in current:
                e['current_review']['claims']=[{'field':c.get('field') or c.get('claim'),
                    'assessment':c.get('assessment') or c.get('status'),'note':c.get('note') or c.get('detail'),
                    'source_urls':c.get('source_urls',[])} for c in current['claims']]
            limit=release.get('country_scope_limits_by_record',{}).get(rid)
            if limit:e['uncertainty']='\n\n'.join(v for v in [e.get('uncertainty'),limit] if v)
        e['review_status'] = 'current_workbook'; e['change_status'] = 'workbook_import'
        events.append(e)
    included = [e for e in events if not e['quarantined']]
    counts = {k: sum(e['timing_coverage'][k] for e in included) for k in FLAGS}
    totals = table(sheets, 'Timing coverage')[0]
    coverage_columns = {'any_dated_evidence':'Any dated evidence','operational_complete':'Complete operational',
        'operational_exact_complete':'Exact complete operational','operational_censored':'Operational censored',
        'same_day':'Same-day operational','formal_policy':'Formal policy','ordered_window':'Ordered window','intermittent_regime':'Intermittent regime'}
    assert len(included) == totals['Included records']
    for key, col in coverage_columns.items(): assert counts[key] == totals[col], (key, counts[key], totals[col])
    counts.update(included_records=len(included), without_dated_evidence=len(included)-counts['any_dated_evidence'],
        without_complete_operational_duration=len(included)-counts['operational_complete'],
        complete_operational_coverage=counts['operational_complete']/len(included),
        phases=sum(len(e['duration_periods']) for e in events),
        included_phases=sum(p['analysis_included'] for e in included for p in e['duration_periods']),
        held_phases=sum(p['contested'] and p['analysis_included'] for e in included for p in e['duration_periods']),
        playback_eligible_records=sum(any(p['evidence_dates'] and p['analysis_included'] for p in e['duration_periods']) for e in included))
    codes = {c: sum(c in e['rationales'] for e in included) for c in categories}
    method = {'model': 'AI-assisted research', 'verification_statement': codebook['Correction release 23 October 2026'],
        'review_limits': 'Source access and unresolved attributes remain explicit. Initial findings are retained as historical review, with subsequent findings in Follow-up review. '+codebook['Coverage and missingness'],
        'current_vs_historical': 'Current Register, Chronology phases, Follow-up review and correction-release Codebook rules supersede initial findings and explicitly labelled historical snapshots.',
        'duration_review': {k: codebook[col] for k,col in {
            'precision_rule':'Endpoint meanings', 'counting_rule':'Duration arithmetic',
            'mapping_rule':'Phase geometry and traffic rules', 'coverage_rule':'Coverage and missingness',
            'rationale_rule':'Rationale and phase rules', 'verification_rule':'Correction release 23 October 2026',
            'continuity_rule':'Map continuity','held_rule':'Held evidence visibility','scope_rule':'Land and airport scope'}.items()},
        'source_sha256': workbook_hash}
    summary = {'rows': len(events), 'included_rows': len(included), 'excluded_rows': len(events)-len(included),
        'mapped_records': sum(bool(e['location_ids']) for e in included),
        'locations': len(reference['locations']['features']),
        'mapping_precision_counts': dict(collections.Counter(e['mapping_precision'] for e in included)),
        'continent_counts': dict(collections.Counter(c for e in included for c in e['continents'])),
        'duration_records': counts['any_dated_evidence'], 'playback_records': counts['playback_eligible_records'],
        'duration_reviewed_unresolved': counts['without_dated_evidence'], 'duration_unreviewed': 0,
        'duration_without_period': counts['without_dated_evidence'], 'monthly_starts': sum(bool(e['onset_month']) for e in included),
        'chronology_coverage': counts}
    frame = table(sheets, 'Frontier frame')
    meta = {'title': 'Border closures: global atlas', 'window_start': '2016-10-21', 'window_end': '2026-10-21',
        'snapshot_date': snapshot, 'source_filename': workbook_name, 'source_sha256': workbook_hash,
        'research_method': method, 'atlas_summary': summary,
        'geometry_source_note': reference['geometry_source_note'],
        'rationale_categories': categories, 'rationale_counts': codes,
        'rationale_definitions': {k:v for k,v in codebook.items() if k in categories or ' / ' in k or k.startswith('Taxonomy ')},
        'codebook':codebook, 'release_summary':table(sheets,'Release summary'),
        'source_model_sha256':codebook['Corrected model identity'],
        'followup_review_count':len(table(sheets,'Follow-up review')),
        'followup_parent_count':sum(bool(e['followup_reviews']) for e in events),
        'phase_binding_counts':dict(collections.Counter(r['Binding decision'] for r in table(sheets,'Phase locations'))),
        'open_issue_parent_count':sum(bool(e['unresolved_issues']) for e in events),
        'source_index_rows': len(table(sheets,'Source index')), 'historical_evidence_links': len(table(sheets,'Evidence')),
        'review_queue_items': len(table(sheets,'Unresolved queue')), 'reviewed_records': len(audits),
        'coverage_frame': {'frontiers': len(frame), 'states': dict(collections.Counter(r['Search state'] for r in frame)),
                           'planned_year_slots': sum(len(split(r['Planned years'])) for r in frame)},
        'timing_coverage': table(sheets,'Timing coverage'),
        'limitations': ['Incomplete, nonrandom inventory; evidence coverage is not closure incidence.',
            'Records, phases and rationale groups may overlap and must not be summed as independent closures.',
            'Held or contested phases are shown only at recorded evidence dates, not as confirmed intervals.',
            'Last observations, schedules and legal transitions do not establish reopening; the later state remains unknown.',
            'Same-model AI review does not establish human or different-model validation.',
            reference['geometry_source_note']]}
    data = {k: copy.deepcopy(reference[k]) for k in ['countries','borders','disputed','locations','links','crossing_contexts','context_locations']}
    # Existing base geometry remains reference cartography, never a source of
    # current dates, motives, phase bindings or verified closure footprints.
    for f in data['locations']['features']+data['context_locations']['features']:
        if f.get('geometry',{}).get('type') in ['LineString','MultiLineString']:
            f['properties']['display_role']='frontier_context'
    data['workbook_geography']={'locations':table(sheets,'Locations'),'phase_locations':table(sheets,'Phase locations')}
    data['workbook_review']={'followup_review':table(sheets,'Follow-up review'),'audit_changes':table(sheets,'Audit changes'),
        'relationships':table(sheets,'Relationships'),'country_year_coverage':table(sheets,'Country-year coverage')}
    excluded_ids = {e['id'] for e in events if e['quarantined']}
    data['links'] = [l for e in events if not e['quarantined'] for l in e['location_links']]
    data.update(meta=meta, events=events)
    return data, {'workbook_sha256': workbook_hash, 'summary': summary, 'rationale_counts': codes,
                  'excluded_ids': sorted(excluded_ids), 'changed_geography_fields': geography_changes}

def compile_release(release, reference, source_name, source_hash, manifest, method):
    """Adapt native tables; the two-tab workbook is a reader, not a data parser."""
    data,report=compile_workbook(native_sheets(release),reference,source_name,source_hash,release)
    meta=data['meta'];counts=release['counts']
    assert (len(data['events']),sum(len(e['duration_periods']) for e in data['events']))==(counts['records'],counts['phases'])
    assert counts['included']==meta['atlas_summary']['included_rows']
    meta['data_state_sha256']=release['data_state_sha256']
    meta['release_id']=method['release_id'];meta['release_method']=copy.deepcopy(method)
    meta['snapshot_date']=release.get('release_metadata',{}).get('snapshot_date',method['release_date'])
    # The preserved workbook includes older release summaries and codebooks.
    # Keep those available as history; none is a current release assertion.
    meta['historical_release_summary']=meta.pop('release_summary')
    meta['historical_source_model_sha256']=meta['source_model_sha256']
    meta['source_model_sha256']=release['data_state_sha256']
    meta['historical_research_method']=meta.pop('research_method')
    meta['historical_research_method'].pop('source_sha256',None)
    meta['historical_research_method']['original_workbook_sha256']=release['workbook_origin_sha256']
    meta['historical_codebook']=meta.pop('codebook')
    meta['audit_metadata_rows']=meta.pop('reviewed_records')
    current_method=copy.deepcopy(release['release_metadata']['research_method'])
    rules={
        'precision_rule':'Retain supported date bounds and endpoint meanings. Observed same-cohort reopening, legal change, announced expiry and last-confirmed observation are distinct. Partial resumption applies only to its stated traffic and direction.',
        'counting_rule':'Minimum and maximum durations are calendar-date boundary differences, not measured elapsed hours. Endpoint inclusion is recorded separately and never adds an automatic day. Same-day and intermittent regimes have no continuous whole-day duration.',
        'mapping_rule':'Each included phase has its own reviewed geographical-scope decision. Sourced crossing-area coordinates are attached only to explicitly applicable phases. Unlocated or rejected matches acquire no inferred point or whole-frontier fallback. Wider lines and country outlines are reference context, not closure footprints; incomplete coverage remains explicit.',
        'coverage_rule':'This is an incomplete, nonrandom inventory. Search and evidence coverage do not measure closure incidence, prove absence, or support causal comparisons. Overlapping parents, phases and rationale groups are not independent counts.',
        'rationale_rule':'Rationale assignments are attributed and nonexclusive. Preserve official explanations, protest demands and analytical coding with their evidence and qualifications; a documented reason does not establish every motive.',
        'verification_rule':current_method['verification_statement'],
        'continuity_rule':'Temporal display follows each current phase and its explicit rule. Evidence does not extend beyond its dated limit; a last observation is not reopening or proof of later continued closure.',
        'held_rule':'Held or contested phases remain discoverable at their recorded evidence dates. They are excluded from numeric continuous-duration claims, confirmed interval animation and supported phase-start filtering.',
        'scope_rule':'The core register covers land-frontier restrictions, including international river-crossing services. Selected Australia, New Zealand and United Kingdom passenger-policy histories remain a separate country-context supplement and do not enter land-border counts or duration charts.'}
    current_method.update(model=method['models']['final_logs'],source_sha256=source_hash,
        data_state_sha256=release['data_state_sha256'],full_history=method['full_text'],
        review_counts=copy.deepcopy(release['review_counts']),duration_review=rules)
    meta['research_method']=current_method
    meta['codebook']={**meta['rationale_definitions'],
        'Release identity':method['release_id'],'Canonical research state':release['data_state_sha256'],
        'Current versus historical':current_method['current_vs_historical'],
        'Endpoint meanings':rules['precision_rule'],'Duration arithmetic':rules['counting_rule'],
        'Phase geometry and traffic rules':rules['mapping_rule'],'Coverage and missingness':rules['coverage_rule'],
        'Rationale and phase rules':rules['rationale_rule'],'Review and evidence provenance':rules['verification_rule'],
        'Map continuity':rules['continuity_rule'],'Held evidence visibility':rules['held_rule'],'Land and national-policy scope':rules['scope_rule']}
    meta['distinct_recorded_urls']=len({u for e in data['events'] for u in e['source_urls']})
    meta['record_url_associations']=sum(len(e['source_urls']) for e in data['events'])
    assert meta['distinct_recorded_urls']==method['counts']['distinct_recorded_urls']
    meta['source_url_definition']=current_method['source_url_definition']
    phase_rows=release['tables']['Chronology phases'];stats=release['review_counts']
    values=[
        ('Release',method['release_id'],'Current release; study window 21 October 2016 to 21 October 2026.'),
        ('Parent records',counts['records'],f"{counts['included']} included; {counts['records']-counts['included']} retained reference/excluded records."),
        ('Chronology phases',counts['phases'],'Separate cohorts, directions, authorities and endpoint meanings remain explicit.'),
        ('Evidence queue rows',meta['review_queue_items'],'Rows retain unresolved, narrowed and recorded follow-up dispositions; not a count of independent unresolved closures.'),
        ('Complete operational phases',sum(bool(p['Complete operational (1=yes)']) for p in phase_rows),'Scoped calendar-date differences, not exact hours or whole-frontier totals.'),
        ('Exact complete operational phases',sum(bool(p['Exact complete operational (1=yes)']) for p in phase_rows),'Day-precision operational subset; policy and announced periods remain separate.'),
        ('Held phases',sum(bool(p['Contested / held (1=yes)']) for p in phase_rows),'Visible evidence, excluded from numeric continuous-duration claims.'),
        ('Completed REC50 cycles',stats['completed_checkpoint_verified_cycles'],'Coverage searches, targeted verification and preselected full-record audits.'),
        ('REC50 full-record audit parents',stats['distinct_full_record_audit_parents'],'Selected full-record source audits; not all parents in the final register.'),
        ('REC50 targeted questions',stats['targeted_questions'],f"Across {stats['distinct_targeted_question_parents']} parents; populations overlap with full-record audits."),
        ('Distinct recorded URLs',meta['distinct_recorded_urls'],current_method['source_url_definition']),
        ('Canonical research state',release['data_state_sha256'],'Native research state before separately audited country/review presentation metadata; compressed release input has its own SHA-256.')]
    meta['release_summary']=[{'Measure':name,'Release value':value,'Meaning / limitation':note} for name,value,note in values]
    for kind,key in [('reader','workbook'),('companion_json','companion_json'),('companion_zip','companion_zip')]:
        item=manifest['downloads'][kind]
        meta['download_'+key]=item['path'];meta['download_'+key+'_sha256']=item['sha256']
    meta['download_source_href']=meta['download_companion_json']
    meta['release_manifest']='downloads/release-manifest.json'
    meta['native_supporting_tables']=len(release['tables'])
    report.update(input_format=release['format'],data_state_sha256=release['data_state_sha256'],
        source_sha256=source_hash,reader_sha256=manifest['files']['reader']['sha256'],
        release_id=method['release_id'],native_supporting_tables=len(release['tables']))
    return data,report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, default=DATA_PATH)
    parser.add_argument('--manifest', type=Path, default=MANIFEST_PATH)
    parser.add_argument('--workbook', type=Path, help='Explicit legacy worksheet input; not the public two-tab reader')
    parser.add_argument('--sheets-json', type=Path)
    parser.add_argument('--reference', type=Path, default=ROOT/'source/geography-reference.json')
    parser.add_argument('--output', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    if args.workbook:
        sheets = json.loads(args.sheets_json.read_text()) if args.sheets_json else read_workbook(args.workbook)
        data,report=compile_workbook(sheets,load_json(args.reference),args.workbook.name,sha256(args.workbook))
    else:
        manifest=read_manifest(args.manifest)
        assert args.release.resolve()==(ROOT/manifest['files']['data']['path']).resolve()
        release=load_json(args.release)
        data,report=compile_release(release,load_json(args.reference),args.release.name,sha256(args.release),
            manifest,load_json(ROOT/manifest['files']['methodology']['path']))
        attach_descriptions(data)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'data.js').write_text('window.BORDER_DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')+';\n')
    write(ROOT/'source/workbook-import-report.json', report)
    write(ROOT/'source/SOURCE_PROVENANCE.json', {
        'sole_research_source': data['meta']['source_filename'],
        'sha256': data['meta']['source_sha256'],
        'source_snapshot': data['meta']['snapshot_date'],
        'source_model_sha256': data['meta']['source_model_sha256'],
        'replacement_policy': 'Complete replacement from the native REC50 tables, with separately audited release country and review metadata. The two-tab workbook is the readable projection of this source.',
        'historical_fields': 'Historical supporting tables and original values are explicitly retained in the native release and override audit.',
        'reference_geometry': 'Retained base geometry is record reference only, not an approved closure footprint. Workbook phase location decisions are preserved separately without inheriting another phase’s coordinates.',
        'verification_statement': data['meta']['research_method']['verification_statement'],
        'summary': data['meta']['atlas_summary'],
        'phase_binding_counts': data['meta']['phase_binding_counts']})
    downloads=args.output/'downloads'; downloads.mkdir(parents=True,exist_ok=True)
    if args.workbook:
        (downloads/args.workbook.name).write_bytes(args.workbook.read_bytes())
    print(json.dumps({'records':len(data['events']), **data['meta']['atlas_summary']['chronology_coverage']}))

if __name__ == '__main__': main()
