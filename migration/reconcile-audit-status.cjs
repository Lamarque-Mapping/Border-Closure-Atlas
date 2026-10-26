'use strict';
// Reconcile the supplemental ledger only after the audited native data is built.
// Preview is the default; --write requires every changed-scope legacy decision
// to have an explicit keep/drop adjudication. No source dates are manufactured.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),C=require('../dist/core.js');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),clone=x=>JSON.parse(JSON.stringify(x));
const filename=path.join(root,'source/border-status-review.json');
const existing=read(filename),historical=clone(existing.historical_audit||existing);
delete historical.historical_audit;
const reviewedAt='2026-10-26',context={window:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8'),context);
const data=context.window.BORDER_DATA,month=C.monthOrdinal(reviewedAt);
assert(data.meta.source_sha256,'Compile the audited release before reconciliation');
const readerTable=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'migration/audit-inputs.json.gz'))).toString('utf8')).reader;
const readers=new Map(readerTable.rows.map(row=>{const r=Object.fromEntries(readerTable.columns.map((c,i)=>[c,row[i]]));return [r['Record ID'],r];}));
const patches=new Map();
for(const name of fs.readdirSync(path.join(root,'migration/phase-patches')).filter(n=>n.endsWith('.json')).sort()){
 for(const r of read(path.join(root,'migration/phase-patches',name)).records||[])for(const p of r.phases)patches.set(p['Phase ID'],p);
}
const included=p=>p.analysis_included!==false;
const unresolved=data.events.filter(e=>!C.excluded(e)&&C.temporalState(e,month)==='none'&&e.duration_periods.some(p=>included(p)&&p.endpoint_status==='last_confirmed')).map(e=>({record_id:e.id,title:e.title,review:'Endpoint classification only; no new confirmation of continuing closure',phases:e.duration_periods.filter(p=>included(p)&&p.endpoint_status==='last_confirmed').map(p=>({phase_id:p.period_id,last_confirmed:p.last_confirmed||p.end_latest||p.start_latest,scope:p.scope}))}));
const phaseIndex=new Map(unresolved.flatMap(r=>r.phases.map(p=>[p.phase_id,{record:r,phase:p}])));
const oldPhases=new Map(historical.unresolved.flatMap(r=>r.phases.map(p=>[p.phase_id,p])));
const decisionsPath=path.join(root,'migration/status-resolution-decisions.json');
const decisions=fs.existsSync(decisionsPath)?read(decisionsPath):{};
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const resolutions=[],decisionLog=[],pending=[];
for(const r of historical.resolutions||[]){
 const match=phaseIndex.get(r.phase_id),old=oldPhases.get(r.phase_id);
 if(!match){decisionLog.push({phase_id:r.phase_id,decision:'retired_from_active_ledger',reason:'Native phase is now bounded, active, excluded, or otherwise outside the unresolved inventory.'});continue;}
 if(r.from<match.phase.last_confirmed){decisionLog.push({phase_id:r.phase_id,decision:'drop',reason:'Later native confirmation supersedes the old resolution chronology.',old_resolution:r,new_phase:match.phase});continue;}
 const explicit=decisions[r.phase_id];
 if(normalize(old?.scope)!==normalize(match.phase.scope)&&!explicit){pending.push({record_id:r.record_id,phase_id:r.phase_id,old_scope:old?.scope,new_scope:match.phase.scope,resolution:r,approved_phase:patches.get(r.phase_id)?.['Audit reader phase text'],approved_qualification:readers.get(r.record_id)?.['Current uncertainty / qualification']});continue;}
 if(explicit){assert(['keep','drop'].includes(explicit.decision)&&explicit.reason,'Invalid explicit scope decision '+r.phase_id);if(explicit.decision==='drop'){decisionLog.push({phase_id:r.phase_id,...explicit});continue;}}
 const retained=clone(r);if(retained.timeline_from&&retained.timeline_from<match.phase.last_confirmed)retained.timeline_from=match.phase.last_confirmed;
 resolutions.push(retained);decisionLog.push({phase_id:r.phase_id,decision:'keep',reason:explicit?.reason||'Same phase identity and unchanged scope; historical bound remains after the native last confirmation.'});
}
const accessMetadata=[];
for(const [phaseId,{record,phase}] of phaseIndex){
 const patch=patches.get(phaseId);if(!patch)continue;
 for(const observation of patch['Later access observations']||[]){
  const date=observation.date_latest||observation.date;
  assert(C.day(date)!==null&&date<=reviewedAt,'Invalid later evidence date '+phaseId);
  const urls=observation.source_urls||String(patch['Source URLs']||'').split(/\s+/).filter(u=>/^https:\/\//.test(u));
  const item={record_id:record.record_id,phase_id:phaseId,...clone(observation),source_urls:urls};accessMetadata.push(item);
  // The reviewer must explicitly adjudicate whole-phase applicability. A
  // permission at one gate or for one cohort does not settle all other access.
  if(observation.applies_to_entire_phase!==true||date<phase.last_confirmed)continue;
  assert(urls.length,'A whole-phase access bound requires the approved source URLs: '+phaseId);
  const candidate={record_id:record.record_id,phase_id:phaseId,from:date,kind:'ended_by',basis:['policy_ended','scope_changed'].includes(observation.basis||observation.kind)?(observation.basis||observation.kind):'later_access',finding_id:record.record_id,evidence_provenance:'Final two-pass audit: explicit phase-scoped later-access metadata',scope:observation.scope,first_reopening:observation.first_reopening===true};
  const i=resolutions.findIndex(r=>r.phase_id===phaseId);
  if(i<0)resolutions.push(candidate);else if(!resolutions[i].evidence_provenance||(resolutions[i].kind==='ended_by'&&candidate.from<resolutions[i].from))resolutions[i]=candidate;
  const at=pending.findIndex(p=>p.phase_id===phaseId);if(at>=0){decisionLog.push({phase_id:phaseId,decision:'replace',reason:'Explicit whole-phase access bound from the final approved audit replaces the changed-scope legacy decision.'});pending.splice(at,1);}
 }
}
const findings=unresolved.map(row=>{
 const reader=readers.get(row.record_id);assert(reader,'Missing final reader row '+row.record_id);
 const old=historical.audit.records.find(r=>r.record_id===row.record_id),integration=resolutions.filter(r=>r.record_id===row.record_id);
 const access=accessMetadata.filter(r=>r.record_id===row.record_id);
 const scopedDecisions=row.phases.map(p=>decisions[p.phase_id]).filter(d=>d?.partial_evidence);
 const sourceMap=new Map((old?.sources||[]).map(s=>[s.url,clone(s)]));
 for(const url of String(reader['All recorded source URLs']||'').split(/\s+/).filter(u=>/^https:\/\//.test(u)))if(!sourceMap.has(url))sourceMap.set(url,{url,title:new URL(url).hostname,provenance:'Final audited reader source inventory; see the source-access limitations for retrieval status.'});
 const outcome=integration.length===row.phases.length?(integration.every(r=>r.kind==='ended_by')?'ended_by':old?.outcome==='reported_current'?'reported_current':'confirmed_current'):integration.length||access.length||scopedDecisions.length?'partial':'unresolved';
 return {record_id:row.record_id,title:row.title,checked_at:reviewedAt,check_kind:'Ledger reconciliation after two full source audits; not a new source-observation date',outcome,evidence_date:integration.length?integration.map(r=>r.from).sort().at(-1):null,
  finding:[reader['Latest verification'],reader['Current uncertainty / qualification'],...scopedDecisions.map(d=>'Scope reconciliation: '+d.reason),access.length?'Separately dated later evidence: '+access.map(a=>a.date+': '+a.scope+(a.applies_to_entire_phase===true?' Matching whole-phase uncertainty is bounded; exact first reopening is not inferred.':' This evidence does not resolve the whole phase.')).join(' '):'',integration.some(r=>r.evidence_provenance)?'Matching end bounds have been integrated from explicit phase-scoped audit metadata.':'',integration.some(r=>!r.evidence_provenance)&&old?'Historical later-status finding retained where still applicable: '+old.finding:''].filter(Boolean).join('\n\n'),
  phases:clone(row.phases),sources:[...sourceMap.values()],integration:clone(integration),current_status_established:integration.some(r=>r.kind==='current_status'),
  limitations:'The inventory is regenerated from the audited native phases. A later access or policy bound removes only matching uncertainty; it is not an exact reopening date, a whole-border opening, continuous access since that date, or a measured closure duration. Partial access leaves other traffic and crossings unresolved.',
  source_access:reader['Recorded source-access limits']||'See the final source audit; this reconciliation performed no new retrieval.',later_access_observations:access};
});
const resolved=new Set(resolutions.map(r=>r.phase_id)),outcomes={};for(const f of findings)outcomes[f.outcome]=(outcomes[f.outcome]||0)+1;
const observations=clone(historical.observations);
const chronology={reviewed_observations:observations.length,observations_with_supported_periods:observations.filter(o=>o.timeline_periods?.length).length,timeline_periods:observations.reduce((n,o)=>n+(o.timeline_periods?.length||0),0),pre_window_regimes:observations.filter(o=>o.timeline_periods?.some(p=>p.start_precision==='pre_window')).length,method:'Original separately sourced status observations and timelines retained unchanged, including their original check dates. Reconciliation does not extend their evidence dates.'};
const active={version:'20261026-two-pass-audit-status-1',reviewed_at:reviewedAt,source_sha256:data.meta.source_sha256,
 method:'Active uncertainty inventory regenerated after the two-pass audit of the historical register. Only included native phases with a last-confirmed endpoint are eligible; native reopening bounds and excluded phases do not carry old uncertainty forward. Matching historical resolutions are retained after scope reconciliation. Explicit later-access metadata may supply a qualified matching end bound; partial and exceptional access does not resolve unrelated traffic or crossings. The earlier review remains dated history. Separately sourced status observations and their supported timelines retain their actual check dates and do not alter historical duration totals.',
 observations,resolutions,unresolved,audit:{reviewed_at:reviewedAt,records_reviewed:findings.length,phases_reviewed:unresolved.reduce((n,r)=>n+r.phases.length,0),research_method:'Ledger reconciliation against the final two-pass source audit and compiled native phases. This is a reconciliation date, not a fresh observation of border conditions. Original status-source checks remain dated in the separate observations and historical audit.',records:findings,counts:{outcomes,records_with_integrated_findings:findings.filter(r=>r.integration.length).length,resolved_phases:resolutions.length,remaining_unverified_phases:unresolved.reduce((n,r)=>n+r.phases.filter(p=>!resolved.has(p.phase_id)).length,0),remaining_unverified_records:unresolved.filter(r=>r.phases.some(p=>!resolved.has(p.phase_id))).length,status_observations:observations.length},chronology_followup:chronology},
 geography_windows:clone(historical.geography_windows||[]),historical_audit:historical,
 reconciliation:{date:reviewedAt,prior_review_date:historical.reviewed_at,decision_log:decisionLog,pending_scope_decisions:pending,later_access_observations:accessMetadata}};
assert.deepEqual(active.observations,historical.observations,'Original observation checks and dates must remain unchanged');
const report={date:reviewedAt,source_sha256:data.meta.source_sha256,historical_records:historical.unresolved.length,historical_phases:historical.unresolved.reduce((n,r)=>n+r.phases.length,0),active_records:unresolved.length,active_phases:active.audit.phases_reviewed,...active.audit.counts,pending_scope_decisions:pending,decision_log:decisionLog,later_access_observations:accessMetadata};
fs.writeFileSync(path.join(root,'migration/status-reconciliation-preview.json'),JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--write')){assert.equal(pending.length,0,'Adjudicate changed-scope legacy resolutions before writing');fs.writeFileSync(filename,JSON.stringify(active,null,2)+'\n');}
console.log(JSON.stringify({written:process.argv.includes('--write'),active_records:unresolved.length,active_phases:active.audit.phases_reviewed,resolutions:resolutions.length,remaining_unverified_records:active.audit.counts.remaining_unverified_records,pending_scope_decisions:pending.length,observations:observations.length}));
