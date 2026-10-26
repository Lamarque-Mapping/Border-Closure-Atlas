'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),C=require('../dist/core.js');
const source=JSON.parse(fs.readFileSync(path.join(root,'source/border-status-review.json'),'utf8'));
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8'),context);
const data=context.window.BORDER_DATA;
assert.equal(source.source_sha256,data.meta.source_sha256);
const month=C.monthOrdinal(source.reviewed_at);
const unresolved=data.events.filter(e=>!C.excluded(e)&&C.temporalState(e,month)==='none'&&e.duration_periods.some(p=>p.analysis_included!==false&&p.endpoint_status==='last_confirmed'));
const derived=unresolved.map(e=>({record_id:e.id,title:e.title,review:'Endpoint classification only; no new confirmation of continuing closure',phases:e.duration_periods.filter(p=>p.analysis_included!==false&&p.endpoint_status==='last_confirmed').map(p=>({phase_id:p.period_id,last_confirmed:p.last_confirmed||p.end_latest||p.start_latest,scope:p.scope}))}));
assert.equal(JSON.stringify(source.unresolved),JSON.stringify(derived),'Stored unresolved-end ledger must match the release');
for(const r of source.unresolved)for(const p of r.phases)assert(C.day(p.last_confirmed)!==null,'Missing last-confirmed date: '+p.phase_id);
const ids=new Set(data.events.map(e=>e.id));
const audit=source.audit;
if(source.historical_audit){
 const history=source.historical_audit;
 assert(history.reviewed_at<source.reviewed_at,'Historical audit must retain its original earlier date');
 assert.deepEqual(source.observations,history.observations,'Reconciliation must preserve every original status observation and check date');
 assert.equal(history.audit.records.length,history.unresolved.length,'Historical review inventory remains complete');
 assert.equal(source.reconciliation.pending_scope_decisions.length,0,'Unadjudicated legacy scope resolution');
}

assert(audit&&audit.records.length===source.unresolved.length,'Review must cover the complete inventory');
assert.equal(new Set(audit.records.map(r=>r.record_id)).size,audit.records.length,'Duplicate assessment');
const findings=new Map(audit.records.map(r=>[r.record_id,r]));
for(const w of source.geography_windows||[]){
 const record=data.events.find(e=>e.id===w.record_id),phase=record?.duration_periods.find(p=>p.period_id===w.phase_id);
 const observation=source.observations.find(o=>o.id===w.observation_id);
 assert(phase&&observation?.linked_land_ids.includes(w.record_id));
 assert(observation.timeline_periods.some(p=>p.from_date===w.from_date&&p.location_ids?.includes(w.location_id)),'Geography timing needs a reviewed location-specific period');
 assert(w.from_date>=phase.start_earliest&&w.from_date<=phase.start_latest,'Geography correction must stay inside the recorded staggered onset range');
}
for(const r of source.unresolved){
 const finding=findings.get(r.record_id);assert(finding,'Missing assessment '+r.record_id);
 assert.equal(JSON.stringify(finding.phases),JSON.stringify(r.phases),'Assessment scope changed: '+r.record_id);
 assert(finding.finding&&finding.source_access&&finding.checked_at===source.reviewed_at);
 assert(finding.sources.every(s=>/^https:\/\//.test(s.url)));
 if(finding.evidence_date)assert(C.day(finding.evidence_date)!==null&&finding.evidence_date<=source.reviewed_at);
}
for(const o of source.observations){
 assert(!ids.has(o.id));ids.add(o.id);assert(['closed','restricted'].includes(o.status));
 assert(C.day(o.observed_at)!==null&&o.observed_at<=source.reviewed_at);
 for(const s of o.sources)if(s.checked_at)assert(C.day(s.checked_at)!==null&&s.checked_at<=source.reviewed_at,'Invalid original source check date');
 assert(o.sources.length&&o.sources.every(s=>/^https:\/\//.test(s.url)));
 assert(Array.isArray(o.location_ids)&&o.scope&&o.qualification);
 if(!o.location_ids.length)assert(/without an unverified map position/.test(o.qualification),'Unmapped status needs an explicit qualification');
 for(const id of o.linked_land_ids||[])assert(ids.has(id),'Unknown linked record '+id);
 if(o.timeline_periods){
  assert(o.timeline_periods.length&&C.day(o.timeline_review?.checked_at)!==null&&o.timeline_review.checked_at<=source.reviewed_at&&o.timeline_review.finding);
  const urls=new Set(o.sources.map(s=>s.url));
  for(const p of o.timeline_periods){
   assert(C.day(p.from_date)!==null&&C.day(p.through_date)!==null&&p.from_date<=p.through_date&&p.through_date<=o.observed_at,'Invalid supported timeline bounds: '+o.id);
   assert(['closed','restricted'].includes(p.status)&&['day','pre_window'].includes(p.start_precision));
   assert(typeof p.end_inclusive==='boolean'&&(p.end_inclusive||p.from_date<p.through_date));
   assert(p.scope&&p.summary&&p.basis&&p.source_urls.length&&p.source_urls.every(url=>urls.has(url)),'Each timeline phase needs matching source evidence');
   if(p.start_precision==='pre_window')assert(p.from_date==='2016-10-21'&&p.start_label==='Already in force before October 2016','Window boundary must not masquerade as an onset');
   if(p.location_ids)assert(p.location_ids.every(id=>o.location_ids.includes(id)),'Timeline geography must stay within reviewed observation scope');
  }
 }
}
// A check date alone is not continuity evidence. Explicit reviewed periods can
// replace the matching unknown interval without altering measured durations.
const resolved=new Set();
for(const resolution of source.resolutions||[]){
 const row=source.unresolved.find(r=>r.record_id===resolution.record_id);
 assert(row,'Unknown endpoint review record');
 const p=row.phases.find(p=>p.phase_id===resolution.phase_id);assert(p);
 assert(!resolved.has(p.phase_id),'Duplicate phase resolution');resolved.add(p.phase_id);
 assert(C.day(resolution.from)!==null&&resolution.from>=p.last_confirmed&&resolution.from<=source.reviewed_at);
 assert(['ended_by','current_status'].includes(resolution.kind));
 if(resolution.basis)assert(resolution.kind==='ended_by'&&['policy_ended','later_access','scope_changed'].includes(resolution.basis),'Unknown resolution basis');
 const finding=findings.get(resolution.finding_id);
 assert(finding?.record_id===row.record_id&&finding.sources.length,'Resolution needs matching sourced assessment');
 if(resolution.kind==='current_status'){
  const observation=source.observations.find(o=>o.id===resolution.observation_id);
  assert(observation?.linked_land_ids.includes(row.record_id)&&observation.observed_at===resolution.from);
  if(resolution.timeline_from){
   assert(C.day(resolution.timeline_from)!==null&&resolution.timeline_from>=p.last_confirmed&&resolution.timeline_from<=resolution.from);
   assert(resolution.timeline_period_indexes?.length);
   const periods=resolution.timeline_period_indexes.map(i=>observation.timeline_periods?.[i]);
   assert(periods.every(Boolean)&&periods.some(p=>p.from_date<=resolution.timeline_from)&&periods.some(p=>p.end_inclusive&&p.through_date===resolution.from),'Timeline resolution needs reviewed coverage');
  }
 }
 p.resolved_from=resolution.timeline_from||resolution.from;
}
assert.equal(audit.counts.resolved_phases,resolved.size);
assert.equal(audit.counts.records_with_integrated_findings,audit.records.filter(r=>r.integration.length).length);
assert.equal(audit.counts.remaining_unverified_phases,source.unresolved.reduce((n,r)=>n+r.phases.filter(p=>!resolved.has(p.phase_id)).length,0));
for(const finding of audit.records)assert.deepEqual(finding.integration.filter(r=>r.phase_id),source.resolutions.filter(r=>r.record_id===finding.record_id),'Audit and map decisions must match: '+finding.record_id);
assert.equal(audit.counts.remaining_unverified_records,source.unresolved.filter(r=>r.phases.some(p=>!resolved.has(p.phase_id))).length);
assert.equal(audit.counts.status_observations,source.observations.length);
const chronology=audit.chronology_followup;
assert.equal(chronology.reviewed_observations,source.observations.length);
assert.equal(chronology.observations_with_supported_periods,source.observations.filter(o=>o.timeline_periods?.length).length);
assert.equal(chronology.timeline_periods,source.observations.reduce((n,o)=>n+(o.timeline_periods?.length||0),0));
assert.equal(chronology.pre_window_regimes,source.observations.filter(o=>o.timeline_periods?.some(p=>p.start_precision==='pre_window')).length);
// The map needs active findings and dated observations, not the complete
// historical research archive. The full source/download/page remain intact.
const historical=source.historical_audit;
const runtime={...source,audit:{...audit,records:audit.records.map(({source_access,later_access_observations,...record})=>record)},
 operator_report_observation_ids:source.observations.filter(o=>[...audit.records,...(historical?.audit?.records||[])].some(r=>r.outcome==='reported_current'&&(o.linked_land_ids||[]).includes(r.record_id))).map(o=>o.id)};
delete runtime.reconciliation;
if(historical)runtime.historical_audit={version:historical.version,reviewed_at:historical.reviewed_at,records_reviewed:historical.audit.records.length,phases_reviewed:historical.unresolved.reduce((n,r)=>n+r.phases.length,0),counts:historical.audit.counts,complete_review:'downloads/border-status-review.json'};
fs.writeFileSync(path.join(root,'dist/status-data.js'),'window.ATLAS_STATUS_REVIEW = '+JSON.stringify(runtime).replace(/</g,'\\u003c')+';\n');
fs.writeFileSync(path.join(root,'dist/downloads/border-status-review.json'),JSON.stringify(source,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist/status-audit.html'),require('./status-audit-page.cjs')(source));
console.log(JSON.stringify({reviewedRecords:audit.records.length,...audit.counts}));
