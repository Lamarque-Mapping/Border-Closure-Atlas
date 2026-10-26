#!/usr/bin/env python3
"""Render Analysis prose and figures from the same compiled data used by the map."""
import argparse
import datetime as dt
import html
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def build(web):
    data = json.loads((web/'data.js').read_text().split('=',1)[1].strip().rstrip(';'))
    m=data['meta']; s=m['atlas_summary']; c=s['chronology_coverage']
    release_method=m['release_method']
    assert release_method['counts']['records']==s['rows'], 'Methods account belongs to another release'
    assert release_method['counts']['phases']==c['phases'], 'Methods phase count differs from the data'
    snapshot=dt.date.fromisoformat(m['snapshot_date'])
    included=[e for e in data['events'] if not e['quarantined']]
    definitions={
      'Security':'Armed conflict, attacks, public order, crime and asserted security threats. Allegations remain attributed; coding does not establish that a claimed threat existed.',
      'Health and biosecurity':'Closures imposed to prevent the spread of human, animal or plant disease. Human disease control and animal or plant disease control are distinct subcategories.',
      'Trade and protectionism':'Import and export controls, customs and transport rules, currency controls and documented trade protests. Affected freight alone does not establish a trade motive.',
      'Migration':'Entry, asylum, exit and transit controls, processing capacity and admission or document disputes. Includes demands to restore passage; direction alone does not establish a migration purpose.',
      'Electoral politics':'Election administration and security, electoral disputes and transitions, and voter access. Proximity to an election alone does not establish purpose.',
      'Interstate disputes and pressure':'Documented sanctions, diplomatic retaliation and disputes over territory or frontier administration. Cross-border effects alone do not establish political pressure.',
      'Power and regime politics':'Coups, succession, opposition, political reform and contested governing authority. Policy or livelihood demands alone do not establish a struggle for governing power.',
      'Policy and socioeconomic demands':'Blockades or restrictions used to press demands over jobs, services, livelihoods, rights or public policy, including protests against health restrictions. An unspecified protest does not establish a particular demand.',
      'Administration and service operation':'Crossing management and maintenance: restrictions imposed to organise or run a crossing itself. This includes three different situations: maintenance or reconstruction; deliberate service suspensions, such as customs holidays; and decisions about which checkpoints are authorised to operate. Examples include reconstruction at Kaplanbek–Navoi and authorisation restrictions at Ak-Tash–Birlishken. An administrative decision alone does not qualify: the source must identify crossing management or service operation as the reason. Security, health and political pressure are coded separately when supported. Accidental outages and routine overnight opening hours are not included simply as administrative closures.',
      'Environment and resource management':'Documented nature conservation or control of cross-border herds and grazing. Disease prevention needs its own evidence and code; location alone does not establish an environmental purpose.'}
    def help_button(cat):
        return '<button type="button" class="category-help" data-category-help="'+html.escape(cat,quote=True)+'" aria-label="Explain '+html.escape(cat,quote=True)+'" aria-haspopup="dialog"><span aria-hidden="true">?</span></button>'
    typology='<div class="typology">'+''.join('<details><summary><h3>'+html.escape(cat)+help_button(cat)+'</h3><span class="type-count" data-count="'+html.escape(cat)+'">'+str(m['rationale_counts'][cat])+' records</span></summary><div><p>'+html.escape(definitions[cat])+'</p><button class="text-button code-filter" data-code="'+html.escape(cat)+'">Explore these records →</button></div></details>' for cat in m['rationale_categories'])+'</div>'
    values={'INCLUDED':s['included_rows'],'EXCLUDED':s['excluded_rows'],
        'CODED':sum(bool(e['rationales']) for e in included),'UNCODED':sum(not e['rationales'] for e in included),
        'DATED':c['any_dated_evidence'],'COMPLETE':c['operational_complete'],
        'EXACT':c['operational_exact_complete'],'UNDATED':c['without_dated_evidence'],'HELD':c['held_phases'],
        'SOURCE_ROWS':format(m['source_index_rows'],','),'DISTINCT_SOURCE_URLS':format(m['distinct_recorded_urls'],','),
        'QUEUE_ITEMS':m['review_queue_items'],
        'QUEUE_RECORDS':sum(bool(e['unresolved_issues']) for e in data['events']),
        'CATEGORY_COUNT':len(m['rationale_categories']),
        'SNAPSHOT':f'{snapshot.day} {snapshot:%B %Y}',
        'SOURCE_FILENAME':html.escape(m['source_filename']),
        'SOURCE_SHA256':m['source_sha256'],
        'WORKBOOK_SHA256':m['download_workbook_sha256'],
        'DOWNLOAD_COMPANION_JSON_URL':html.escape(m['download_companion_json']+'?v='+m['download_companion_json_sha256']),
        'DOWNLOAD_COMPANION_JSON_FILENAME':html.escape(Path(m['download_companion_json']).name),
        'DOWNLOAD_COMPANION_ZIP_URL':html.escape(m['download_companion_zip']+'?v='+m['download_companion_zip_sha256']),
        'DOWNLOAD_COMPANION_ZIP_FILENAME':html.escape(Path(m['download_companion_zip']).name),
        'RESEARCH_HISTORY':'<p>'+html.escape(release_method['full_text'])+'</p>',
        'REVIEW_LIMITS':html.escape(m['research_method']['verification_statement']+' '+m['research_method']['review_limits']),
        'TYPOLOGY':typology}
    text=(ROOT/'scripts/analysis-template.html').read_text()
    for k,v in values.items(): text=text.replace('{{'+k+'}}',str(v))
    assert not re.search(r'\{\{[A-Z_]+\}\}',text), 'Unresolved Analysis template value'
    script='window.BorderCategoryExplanations='+json.dumps(definitions,ensure_ascii=False).replace('<','\\u003c')+';\n'+(web/'duration.js').read_text()+'\n'+(web/'record-summary.js').read_text()+'\n'+(ROOT/'scripts/analysis-metrics.js').read_text()+'\n'+(ROOT/'scripts/analysis-regions.js').read_text()+'\n'+(ROOT/'scripts/analysis-ui.js').read_text()
    text=text.replace('<!-- ANALYSIS_SCRIPT -->','<script>\n'+script+'\n</script>')
    (web/'analysis.html').write_text(text)
    if (web/'map-data.js').exists():
        subprocess.run(['node', str(ROOT/'scripts/build-analysis-data.cjs'), str(web)], check=True)
    print('Analysis built from '+m['source_filename']+' · '+m['source_sha256'])

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('web',type=Path,nargs='?',default=ROOT/'dist');build(p.parse_args().web)

