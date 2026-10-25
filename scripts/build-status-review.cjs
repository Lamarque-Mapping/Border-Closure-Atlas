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
for(const o of source.observations){
 assert(!ids.has(o.id));ids.add(o.id);assert(['closed','restricted'].includes(o.status));
 assert(C.day(o.observed_at)!==null&&o.observed_at<=source.reviewed_at);
 assert(o.sources.length&&o.sources.every(s=>/^https:\/\//.test(s.url)));
 assert(o.location_ids.length&&o.scope&&o.qualification);
 for(const id of o.linked_land_ids||[])assert(ids.has(id),'Unknown linked record '+id);
}
// Snapshots are additional observations, not retrospective proof that every
// intervening day was closed. Resolved dates only suppress a matching unknown
// marker at a separately reviewed scope, never every phase of a parent record.
for(const resolution of source.resolutions||[]){
 const row=source.unresolved.find(r=>r.record_id===resolution.record_id);
 assert(row,'Unknown endpoint review record');
 const p=row.phases.find(p=>p.phase_id===resolution.phase_id);assert(p);
 assert(source.observations.some(o=>o.id===resolution.observation_id));
 p.resolved_from=resolution.from;
}
fs.writeFileSync(path.join(root,'dist/status-data.js'),'window.ATLAS_STATUS_REVIEW = '+JSON.stringify(source).replace(/</g,'\\u003c')+';\n');
fs.writeFileSync(path.join(root,'dist/downloads/border-status-review.json'),JSON.stringify(source,null,2)+'\n');
console.log(JSON.stringify({unresolvedRecords:source.unresolved.length,unresolvedPhases:source.unresolved.reduce((n,r)=>n+r.phases.length,0),statusObservations:source.observations.length}));
