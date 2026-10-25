'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),C=require('../dist/core.js');
const source=JSON.parse(fs.readFileSync(path.join(root,'source/border-status-review.json'),'utf8'));
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8'),context);
const data=context.window.BORDER_DATA;
assert.equal(source.source_sha256,data.meta.source_sha256);
const month=C.monthOrdinal(source.reviewed_at);
const unresolved=data.events.filter(e=>!C.excluded(e)&&C.temporalState(e,month)==='none'&&e.duration_periods.some(p=>p.endpoint_status==='last_confirmed'));
const derived=unresolved.map(e=>({record_id:e.id,title:e.title,review:'Endpoint classification only; no new confirmation of continuing closure',phases:e.duration_periods.filter(p=>p.endpoint_status==='last_confirmed').map(p=>({phase_id:p.period_id,last_confirmed:p.last_confirmed||p.end_latest||p.start_latest,scope:p.scope}))}));
assert.equal(JSON.stringify(source.unresolved),JSON.stringify(derived),'Stored unresolved-end ledger must match the release');
for(const r of source.unresolved)for(const p of r.phases)assert(C.day(p.last_confirmed)!==null,'Missing last-confirmed date: '+p.phase_id);
const ids=new Set(data.events.map(e=>e.id));
const audit=source.audit;
assert(audit&&audit.records.length===source.unresolved.length,'Review must cover the complete inventory');
assert.equal(new Set(audit.records.map(r=>r.record_id)).size,audit.records.length,'Duplicate assessment');
const findings=new Map(audit.records.map(r=>[r.record_id,r]));
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
 assert(o.sources.length&&o.sources.every(s=>/^https:\/\//.test(s.url)));
 assert(Array.isArray(o.location_ids)&&o.scope&&o.qualification);
 if(!o.location_ids.length)assert(/without an unverified map position/.test(o.qualification),'Unmapped status needs an explicit qualification');
 for(const id of o.linked_land_ids||[])assert(ids.has(id),'Unknown linked record '+id);
}
// Snapshots are additional observations, not retrospective proof that every
// intervening day was closed. Resolved dates only suppress a matching unknown
// marker at a separately reviewed scope, never every phase of a parent record.
const resolved=new Set();
for(const resolution of source.resolutions||[]){
 const row=source.unresolved.find(r=>r.record_id===resolution.record_id);
 assert(row,'Unknown endpoint review record');
 const p=row.phases.find(p=>p.phase_id===resolution.phase_id);assert(p);
 assert(!resolved.has(p.phase_id),'Duplicate phase resolution');resolved.add(p.phase_id);
 assert(C.day(resolution.from)!==null&&resolution.from>=p.last_confirmed&&resolution.from<=source.reviewed_at);
 assert(['ended_by','current_status'].includes(resolution.kind));
 const finding=findings.get(resolution.finding_id);
 assert(finding?.record_id===row.record_id&&finding.sources.length,'Resolution needs matching sourced assessment');
 if(resolution.kind==='current_status'){
  const observation=source.observations.find(o=>o.id===resolution.observation_id);
  assert(observation?.linked_land_ids.includes(row.record_id)&&observation.observed_at===resolution.from);
 }
 p.resolved_from=resolution.from;
}
assert.equal(audit.counts.resolved_phases,resolved.size);
assert.equal(audit.counts.remaining_unverified_records,source.unresolved.filter(r=>r.phases.some(p=>!resolved.has(p.phase_id))).length);
assert.equal(audit.counts.status_observations,source.observations.length);
fs.writeFileSync(path.join(root,'dist/status-data.js'),'window.ATLAS_STATUS_REVIEW = '+JSON.stringify(source).replace(/</g,'\\u003c')+';\n');
fs.writeFileSync(path.join(root,'dist/downloads/border-status-review.json'),JSON.stringify(source,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist/status-audit.html'),require('./status-audit-page.cjs')(source));
console.log(JSON.stringify({reviewedRecords:audit.records.length,...audit.counts}));
