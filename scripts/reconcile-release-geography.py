#!/usr/bin/env python3
"""Apply explicit phase-scope decisions to preserved, sourced geography.

This is release reconciliation, not new coordinate research. The classifications
below were checked against each current phase's text. A known crossing may reuse
an already sourced crossing-area reference; rail/road terminals, approaches and
unresolved identities never acquire a convenient nearby point.
"""
import collections
import copy
import json
from release_common import ROOT,DATA_PATH,load_json,sha256

# Labels and IDs are deliberate decisions, not a text-matching geocoder.
SINGLES={
 'Khorgos International Centre for Border Cooperation':['R11-001-P1'],
 'Manzhouli railway port':['R11-002-P1'],
 'Manzhouli road port':['R11-002-P2'],
 'Suifenhe railway port':['R11-003-P1'],
 'Erenhot–Zamyn-Uud railway crossing':['R11-004-P1','R11-EA003-P1'],
 'Petrapole–Benapole':['R12-001-P1','R12-002-P1','R12-003-P1','R12-004-P1','R12-006-P2','R33-004-P1','R33-006-P1','R33-006-P2'],
 'Hili':['R12-005-P1','R33-002-P1'],
 'Sonamasjid–Mahadipur':['R12-006-P1','R33-001-P1'],
 'Dehiba–Wazen':['R13-001-P1','R13-002-P1','R13-003-P1','R13-004-P1','R21-001-P1','R21-003-P1','R21-004-P1','R48-005-P1'],
 'Rafah':['R13-005-P1','R13-005-P2'],
 'Kerem Shalom–Karm Abu Salem':['R13-006-P1','R13-007-P1','R13-ME026-P1'],
 'Kaplanbek–Navoi / Zangiota':['R17-001-P1'],
 'Zhibek Zholy–Gishtkuprik':['R17-002-P1'],
 'Tazhen–Daut Ata':['R17-003-P1'],
 'Atameken–Gulistan / Syrdarya':['R17-004-P1'],
 'Kazygurt–S. Nadzhimov':['R17-004-P2'],
 'Ken-Sai–Uch-Kurgan':['R17-006-P1'],
 'Cristo Redentor–Los Libertadores crossing and Argentine approach':['R18-001-P1'],
 'Yacuiba–Salvador Mazza bridge and access':['R18-002-P1','R18-003-P1','R18-004-P1','R18-005-P1','R18-006-P1'],
 'Ras Jedir crossing and Ben Guerdane approach':['R21-002-P1','R21-002-P2'],
 'Ghulam Khan':['R23-001-P1'],
 'Kharlachi':['R23-002-P1'],
 'Chaman–Spin Boldak':['R23-003-P1','R23-004-P1','R23-005-P1'],
 'Angoor Adda':['R23-006-P1'],
 'Kasumbalesa':['R26-001-P1','R26-002-P1','R26-003-P1'],
 'Kasindi–Mpondwe':['R26-005-P2'],
 'Bagratashen–Sadakhlo':['R27-001-P1'],
 'Agarak–Meghri':['R27-002-P1'],
 'Enguri bridge':['R27-003-P1','R44-ENGURI-P1'],
 'Myawaddy–Mae Sot Friendship Bridge II':['R28-001-P1'],
 'Myawaddy–Mae Sot Friendship Bridge I':['R28-001-P2'],
 'Maungdaw–Teknaf river cargo service':['R28-002-P1'],
 'Singkhon–Mawtaung border area':['R28-003-P1','R28-003-P2'],
 'Aranyaprathet–Poipet road crossing':['R28-PH001'],
 'Pharr–Reynosa International Bridge':['R31-001-P1','R31-003-P1','R31-004-P1'],
 'Ysleta–Zaragoza International Bridge':['R31-001-P2'],
 'Bridge of the Americas cargo lot':['R31-002-P1'],
 'Seaway bridge system / North Channel approach':['R31-005-P1'],
 'San Antonio principal customs access (bridge unresolved)':['R32-002-P1'],
 'San Antonio–Simón Bolívar bridge':['R32-003-P1'],
 'Banglabandha–Phulbari':['R33-003-P1','R44-BANGLABANDHA-P1'],
 'Jamunaha':['R33-005-P1'],
 'Rasuwagadhi':['R33-R2SC008-P1'],
 'Erez–Beit Hanoun':['R38-001-P1','R38-002-P1'],
 'Semalka–Faysh Khabur':['R38-003-P1','R38-004-P1'],
 'Rabia–al-Yarubiyah':['R38-005-P1','R47-R38-005-P1'],
 'Wadi Araba–Yitzhak Rabin':['R38-ME021-P1'],
 'Jordan River–Sheikh Hussein':['R38-ME021-P2'],
 'Shiveekhuren–Ceke':['R41-001-P1'],
 'Gashuunsukhait–Ganqimaodu':['R41-002-P1'],
 'Tsagaannuur–Tashanta':['R41-003-P1'],
 'Ruse–Giurgiu crossing approach':['R42-001-P1','R42-002-P1','R42-003-P1','R42-003-P3'],
 'Kardam–Negru Voda crossing approach':['R42-001-P2','R42-002-P2','R42-003-P6'],
 'Vidin–Calafat crossing approach':['R42-001-P3','R42-003-P2','R42-003-P4'],
 'Vama Veche–Durankulak crossing approach':['R42-003-P5'],
 'Evzoni–Bogorodica':['R42-004-P1'],
 'Canawaima / Moleson Creek–South Drain ferry':['R46-004-P1'],
 'La Gabrielle / Saint-Laurent-du-Maroni–Albina ferry':['R46-005-P1'],
 'Adré':['R47-001-P1','R47-001-P2'],
 'Bab al-Hawa–Cilvegözü':['R47-002-P1'],
 'Alashankou road crossing (railway excluded)':['R48-001-P1'],
}
WIDER={
 'National vehicle/carrier admissibility rule; a named implementation site does not delimit the whole legal rule.':['R22-002-P1','R22-003-P1','R22-004-P1','R22-005-P1','R48-002-P1','R48-003-P1','R48-004-P1'],
 'National land-frontier rule; no evidence that every gate was operationally closed.':['R26-005-P1','R32-001-P1','R36-001-P1','R36-002-P1','R36-003-P1','R36-004-P1','R47-GL05-P1'],
 'Commodity/permit policy applies beyond a named gate. Origin and destination qualifications remain in the phase; a country reference is not an observed enforcement footprint.':['R43-001-P1','R43-002-P1','R43-003-P1','R43-003-P2','R43-003-P3','R43-004-P2','R43-005-P1','R46-001-P1','R46-002-P1','R46-003-P1'],
}
MULTIPLE={
 'Karombo and Goli–Anzida':['R26-004-P1'],
 'Chanika, Katuna, Kyeshero and Ishasha customs routes':['R26-GL13-P1'],
 'Tatale, Wonjuga, Bunkpurugu and Saboba customs stations':['R43-004-P1'],
}
UNRESOLVED={
 'R22-006-P1':'Specific sanctioned railway corridor through Lithuania; no complete gate/rail alignment review. Do not substitute road crossings or an entire land frontier.',
 'R22-006-P2':'The observed cement train names Kena within a longer transit corridor; route applicability and railway coordinates need review. Do not use a nearby road point.',
 'R37-H11-P1':'Djibouti–Ethiopia passenger-train service, without a named border rail position. Do not substitute national land-passenger geography.',
 'R42-005-P1':'The obstruction is at Kalpaki on the approach serving two customs crossings. Neither crossing point establishes the roadblock location.',
 'R47-003-P1':'Ukhia/Ghumdhum are sector descriptions; no exact gate or complete restricted segment is established.',
}
# Reuse only exact crossing identities already supported by the preserved
# location evidence. No new coordinate is introduced by this release.
SITE_REUSE={
 'Petrapole–Benapole':'post-petrapole-benapole',
 'Rafah':'post-rafah','Kerem Shalom–Karm Abu Salem':'post-kerem-shalom',
 'Ras Jedir crossing and Ben Guerdane approach':'post-ras-jedir',
 'Chaman–Spin Boldak':'post-chaman-friendship-gate',
 'Kasumbalesa':'post-kasumbalesa','Kasindi–Mpondwe':'post-mpondwe-kasindi',
 'Enguri bridge':'post-enguri','Aranyaprathet–Poipet road crossing':'post-poipet-khlong-luek',
 'Ysleta–Zaragoza International Bridge':'post-ysleta-zaragoza',
 'Bridge of the Americas cargo lot':'post-bridge-of-the-americas',
 'Erez–Beit Hanoun':'post-erez-beit-hanoun',
 'Shiveekhuren–Ceke':'post-shiveekhuren-ceke',
 'Gashuunsukhait–Ganqimaodu':'post-gashuunsukhait-ganqimaodu',
}
CHANGED_BINDING_SCOPES={
 'CC022-D1':'The current qualification narrows the first returned cohort to an Iran-to-Afghanistan cargo truck; it still names Islam Qala–Dogharoun.',
 'R3-AF-007-D1':'The current endpoint is a Uganda-to-South Sudan bus observation. The same Nimule–Elegu crossing-area reference remains applicable.',
 'ME026-C7P1':'The current scope still identifies Kerem Shalom, while eligibility remains held. The point is reference geography and does not resolve the disputed restriction.',
}

def main():
    release=load_json(DATA_PATH);tables=release['tables'];date=load_json(ROOT/'source/release-method.json')['release_date']
    phases={p['Phase ID']:p for p in tables['Chronology phases'] if p['Parent included (1=yes)']}
    included={r['ID'] for r in tables['Register'] if r['Analysis inclusion']=='Included'}
    scope_ref=release['geometry_reference_files']['source/crossings/scope-review.json']
    location_ref=release['geometry_reference_files']['source/crossings/locations.json']
    scope=copy.deepcopy(scope_ref['content']);locations=copy.deepcopy(location_ref['content'])
    old={r['phase_id'] or r['record_id']:r for r in scope['rows']}
    decisions={}
    def add(ids,category,label,note):
        for short in ids:
            pid='REC50-'+short;assert pid not in decisions
            decisions[pid]={'category':category,'site_label':label,'note':note}
    for label,ids in SINGLES.items():
        add(ids,'single_site',label,'Current phase names one crossing/service. A point, if available, is only a sourced crossing-area reference; exact access obstructions and facilities may remain unlocated.')
    for note,ids in WIDER.items(): add(ids,'wider_border',None,note)
    for label,ids in MULTIPLE.items(): add(ids,'multiple_named_sites',label,'Each named site needs its own phase-specific coordinate approval. No midpoint or whole-frontier fallback.')
    for pid,note in UNRESOLVED.items(): add([pid],'needs_review',None,note)
    assert set(decisions)==set(phases)-set(old),('Unreviewed/extraneous phase decisions',sorted((set(phases)-set(old))^set(decisions)))
    rows=[]
    for pid,p in phases.items():
        row=copy.deepcopy(old.get(pid) or decisions[pid])
        row.update(record_id=p['Parent record ID'],phase_id=pid,current_phase_scope=p['Movement / crossing / phase scope'])
        row['release_scope_decision']='current_phase_text_review' if pid in decisions else 'preserved_review_reconciled_to_current_phase'
        row['release_review_date']=date
        rows.append(row)
    undated=included-{p['Parent record ID'] for p in phases.values()}
    for rid in sorted(undated):
        row=copy.deepcopy(old[rid]);row['current_phase_scope']=None;rows.append(row)
    bindings=[]
    for binding in locations['bindings']:
        b=copy.deepcopy(binding);p=phases[b['phase_id']];current=p['Movement / crossing / phase scope']
        previous=b.get('phase_scope_reviewed') or b.get('phase_scope')
        assert previous is None or previous==current or previous.startswith(current+'; ') or b['phase_id'] in CHANGED_BINDING_SCOPES,('Changed coordinate applicability needs review',b['phase_id'])
        b['current_phase_scope']=current;b['release_review_date']=date
        if b['phase_id'] in CHANGED_BINDING_SCOPES:b['release_applicability_note']=CHANGED_BINDING_SCOPES[b['phase_id']]
        bindings.append(b)
    new_bindings=[]
    for pid,row in decisions.items():
        site=SITE_REUSE.get(row['site_label'])
        if not site:continue
        p=phases[pid]
        b={'record_id':p['Parent record ID'],'phase_id':pid,'site_id':site,'current_phase_scope':p['Movement / crossing / phase scope'],
            'review_date':date,'release_review_date':date,'complete':row['site_label']!='Ras Jedir crossing and Ben Guerdane approach',
            'note':'Current recorded phase scope was checked against this already sourced crossing identity. Coordinates are reused as an approximate crossing-area reference; source cohorts, directions and temporal rules are unchanged.',
            'phase_source_urls':p['Source URLs'].splitlines() if p.get('Source URLs') else []}
        if not b['complete']:b['note']+=' The wider Ben Guerdane approach remains unlocated.'
        bindings.append(b);new_bindings.append(b)
    bound={b['phase_id'] for b in bindings};sites={s['id'] for s in locations['sites']}
    assert all(b['site_id'] in sites for b in bindings)
    fingerprint=sha256(DATA_PATH)
    reconciliation={'release_id':load_json(ROOT/'source/release-method.json')['release_id'],
        'data_state_sha256':release['data_state_sha256'],'source_sha256':fingerprint,
        'previous_scope_file_sha256':scope_ref['sha256'],'previous_locations_file_sha256':location_ref['sha256'],
        'reviewed_new_phases_since_github':sum(pid.startswith('REC50-') for pid in phases),
        'new_scope_decisions_after_preserved_review':len(decisions),'new_coordinate_points':0,
        'additional_bindings_to_existing_sourced_sites':len(new_bindings),
        'changed_existing_binding_applicability':CHANGED_BINDING_SCOPES,
        'method':'Read current recorded phase scopes and existing source-backed location identities; no new source retrieval or coordinate estimation. Broader rules do not borrow narrower gate coordinates. Explicit incomplete coverage takes precedence over complete bindings.'}
    scope.update(source_sha256=fingerprint,review_date=date,rows=rows,release_reconciliation=reconciliation)
    locations.update(source_sha256=fingerprint,review_date=date,bindings=bindings,release_reconciliation=reconciliation)
    locations['unlocated']=[{**r,'reason':r.get('note') or 'No phase-specific sourced coordinate approved.'} for r in rows if r['phase_id'] and r['phase_id'] not in bound and r['category']!='wider_border']
    directory=ROOT/'source/crossings'
    for name,value in [('scope-review.json',scope),('locations.json',locations),('release-reconciliation.json',
        {**reconciliation,'category_counts':dict(collections.Counter(r['category'] for r in rows)),
         'screened_phases':len(phases),'undated_records':len(undated),'mapped_phases':len(bound),
         'new_decisions':[{**row,'phase_id':pid,'current_phase_scope':phases[pid]['Movement / crossing / phase scope']} for pid,row in decisions.items()],
         'additional_bindings':new_bindings})]:
        (directory/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in reconciliation.items() if k not in {'changed_existing_binding_applicability','method'}}))

if __name__=='__main__':main()
