/* Border associations are dated, qualified references, never exact crossing
 * coordinates or proof of closure along the full international boundary. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),C=require('../dist/core.js'),K=require('../dist/cartography.js'),X=require('../dist/crossing-geography.js'),D=require('../dist/duration.js');
const raw=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.js'),'utf8').replace(/^window.BORDER_DATA = /,'').replace(/;\s*$/,''));
if(raw.geometry_pool){for(const key of ['countries','borders','disputed','locations','context_locations'])for(const f of raw[key].features)f.geometry=raw.geometry_pool[f.geometry];delete raw.geometry_pool;}
const originalEvents=JSON.stringify(raw.events),data=X.attach(raw),review=JSON.parse(fs.readFileSync(path.join(root,'source/crossings/border-reference-review.json')));
assert.equal(JSON.stringify(data.events),originalEvents,'border references do not edit source records or dates');
assert(review.bindings.length>0,'reviewed border references exist');
const originalAudit=JSON.parse(fs.readFileSync(path.join(root,'research/geography-audit-2026-10-29/reconciled-decisions.json')));
const held=originalAudit.decisions.filter(d=>!d.phases.some(p=>['map','partial'].includes(p.decision))),heldIDs=held.map(d=>d.record_id).sort(),heldByID=new Map(held.map(d=>[d.record_id,d]));
const bindingRecords=[...new Set(review.bindings.map(b=>b.record_id))],holdIDs=review.holds.map(h=>h.record_id);
assert.equal(heldIDs.length,145,'the original unmapped audit universe is fixed');
assert.equal(new Set(holdIDs).size,holdIDs.length,'remaining holds are unique');
assert(!bindingRecords.some(id=>holdIDs.includes(id)),'record-level reference additions and holds are disjoint');
assert.deepEqual([...bindingRecords,...holdIDs].sort(),heldIDs,'every original held record receives a reference decision or an explicit hold');
assert(review.holds.every(h=>h.reason),'every remaining hold has a reason');
const array=v=>Array.isArray(v)?v:[];
const features=new Map(C.locationFeatures(data).map(f=>[f.properties.location_id,f])),all={mode:'all',duration:'all'},seen=new Set();
for(const binding of review.bindings){
 const event=data.events.find(e=>e.id===binding.record_id),phase=event.duration_periods.find(p=>p.period_id===binding.phase_id),one={...event,duration_periods:[phase]},id=binding.location_id;
 assert(phase&&phase.analysis_included!==false,'each association belongs to an included dated phase');
 const originalPhase=heldByID.get(binding.record_id)?.phases.find(p=>p.phase_id===binding.phase_id);
 assert(originalPhase&&!['map','partial'].includes(originalPhase.decision),'references only supplement original held phases');
 assert.equal(C.mapLocationsFor(one,data,{...all,duration:'over1'}).includes(id),D.qualifies(phase,event),'border association obeys the >24h phase filter');
 assert(C.mapLocationsFor(one,data,all).includes(id),'the associated border is discoverable');
 assert(/^(?:Multi)?LineString$/.test(features.get(id).geometry.type),'association uses border line geometry');
 const scoped=C.recordsForLocation([one],id,data,all)[0];
 assert(scoped.map_border_reference_only&&scoped.map_border_reference,'popup and styling receive border-reference qualification');
 assert(scoped.map_border_reference_notes.length>0,'popup/export qualification retained');
 const style=K.symbolStyle(features.get(id).properties,{records:[scoped]});
 assert(style.scope.borderReference&&style.scope.limited&&!style.scope.broad&&style.dash.length,'associated border is always dotted');
 const status=C.mappingStatus(one,data,all);
 assert(status.referenceOnly&&status.pending&&!status.preciselyMapped,'reference is distinguished from verified restriction geometry');
 for(let month=C.monthOrdinal(data.meta.window_start);month<=C.monthOrdinal(data.meta.window_end);month++){
  const state={mode:'intervals',duration:'all',month},active=C.phaseTemporalState(phase,month)!=='none';
  assert.equal(C.mapLocationsFor(one,data,state).includes(id),active,'border reference respects recorded dates without inferring continuity: '+binding.phase_id);
  const onset=array(event.phase_onsets).some(p=>p.phase_id===phase.period_id&&C.monthOrdinal(p.month)===month);
  assert.equal(C.mapLocationsFor(one,data,{...state,mode:'onsets'}).includes(id),onset,'border reference obeys supported phase onset months: '+binding.phase_id);
 }
 const excluded={...one,excluded_from_map:true};
 assert.deepEqual(C.mapLocationsFor(excluded,data,all),[],'excluded records cannot acquire reference lines');
 seen.add(binding.record_id);
}
// A national-sounding scope must not override the explicit reference status.
const broad={scope:'All land borders',duration_periods:[{scope:'All land borders'}],map_border_reference:true,rationales:['Security']};
assert(K.scopeStyle([broad]).limited&&!K.scopeStyle([broad]).broad,'broad source wording cannot promote unresolved geometry to a solid line');
assert(K.symbolStyle({display_role:'frontier_context'},{records:[broad]}).dash.length,'dotted reference uses same cartography as exported PNG');
assert.equal(K.scopeStyle([{...broad,map_border_reference:false}]).broad,true,'existing border-wide depiction remains available');
console.log('Border references passed: '+review.bindings.length+' phase-border bindings across '+seen.size+' records; qualified dotted styling, unchanged chronology and all monthly visibility checked.');
